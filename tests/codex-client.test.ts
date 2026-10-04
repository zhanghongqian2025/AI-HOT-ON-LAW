import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { z } from "zod";
import { closeDb, sql } from "@aihot/backend/db";
import { invokeCodexClient } from "@aihot/backend/providers/codex-client";
import { chatJson } from "@aihot/backend/providers/llm";
import { runSelectionPrefilter, ScoreSchema, StructureSchema, type AnalyzeInputArticle } from "@aihot/backend/editorial/analyze";
import { PeriodSchema } from "@aihot/backend/reports/compose";
import { stopBoss } from "@aihot/backend/jobs/queue";
import { tag } from "./setup.ts";

const dir = await mkdtemp(path.join(os.tmpdir(), "lawhot-codex-test-"));
const executable = path.join(dir, "fake-codex");
const capture = path.join(dir, "calls.jsonl");
const T = tag();

before(async () => {
  const program = `#!${process.execPath}
const fs = require("node:fs");
let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", chunk => input += chunk);
process.stdin.on("end", () => {
  const args = process.argv.slice(2);
  const schemaIndex = args.indexOf("--output-schema");
  const record = { args, cwd: process.cwd(), input, schema: schemaIndex < 0 ? null : JSON.parse(fs.readFileSync(args[schemaIndex + 1], "utf8")) };
  fs.appendFileSync(${JSON.stringify(capture)}, JSON.stringify(record) + "\\n");
  console.log(JSON.stringify({ type: "thread.started", thread_id: "thread-test" }));
  console.log(JSON.stringify({ type: "turn.started" }));
  if (input.includes("ATTEMPT_TOOL")) {
    console.log(JSON.stringify({ type: "item.completed", item: { type: "command_execution", command: "pwd" } }));
    return setInterval(() => {}, 1000);
  }
  if (input.includes("FAIL_STDOUT")) {
    console.log(JSON.stringify({ type: "turn.failed", error: { message: "output schema rejected" } }));
    return process.exitCode = 1;
  }
  const response = input.includes("\u6cd5\u5f8b\u6848\u6e90\u7ebf\u7d22\u76f8\u5173\u6027\u9884\u7b5b") ? { label: "PASS", reason: "fixture" }
    : input.includes("SCORE_SCHEMA_FIXTURE") ? { attentionScore: 80 }
    : input.includes("STRUCTURE_SCHEMA_FIXTURE") ? { scope: "unknown", category: null, tags: [], subjects: [], fact: null }
    : input.includes("PERIOD_SCHEMA_FIXTURE") ? { overview: "", sections: {} }
    : { ok: true };
  console.log(JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: JSON.stringify(response) } }));
  console.log(JSON.stringify({ type: "turn.completed", usage: { input_tokens: 11, cached_input_tokens: 2, output_tokens: 3 } }));
});
`;
  await writeFile(executable, program, { mode: 0o700 });
  await chmod(executable, 0o700);
});

after(async () => {
  delete process.env.LLM_PROVIDER;
  delete process.env.CODEX_CLI_PATH;
  delete process.env.CODEX_MODEL;
  delete process.env.CODEX_REASONING_EFFORT;
  delete process.env.PREFILTER_MODEL;
  await stopBoss();
  await closeDb();
  await rm(dir, { recursive: true, force: true });
});

test("Codex client uses a stateless read-only argv invocation and reads final output with usage", async () => {
  const result = await invokeCodexClient({
    executable,
    env: process.env,
    model: "gpt-6.1-sol",
    reasoningEffort: "high",
    prompt: "Return the object",
    timeoutMs: 10_000,
    outputSchema: { type: "object", properties: { ok: { type: "boolean" } }, required: ["ok"], additionalProperties: false },
  });
  assert.equal(result.requestId, "thread-test");
  assert.equal(result.response.choices[0]!.message.content, '{"ok":true}');
  assert.deepEqual(result.usage, { input_tokens: 11, cached_input_tokens: 2, output_tokens: 3 });

  const call = JSON.parse((await readFile(capture, "utf8")).trim().split("\n")[0]!) as { args: string[]; cwd: string; input: string; schema: unknown };
  assert.deepEqual(call.args.slice(0, 2), ["exec", "--ignore-user-config"]);
  for (const expected of ["--ephemeral", "--skip-git-repo-check", "--json", "--output-schema"]) assert.ok(call.args.includes(expected), expected);
  assert.deepEqual(call.args.slice(call.args.indexOf("--sandbox"), call.args.indexOf("--sandbox") + 2), ["--sandbox", "read-only"]);
  assert.ok(call.args.includes("features.shell_tool=false"));
  assert.ok(call.args.includes("features.unified_exec=false"));
  assert.ok(call.args.includes("features.shell_snapshot=false"));
  assert.ok(call.args.includes("features.multi_agent=false"));
  assert.ok(call.args.includes("features.apps=false"));
  assert.ok(call.args.includes("features.hooks=false"));
  assert.ok(call.args.includes("features.view_image=false"));
  assert.ok(call.args.includes("features.image_generation=false"));
  assert.ok(call.args.includes("features.plugins=false"));
  assert.ok(call.args.includes("features.remote_plugin=false"));
  assert.ok(call.args.includes('web_search="disabled"'));
  assert.ok(call.args.includes('forced_login_method="chatgpt"'));
  assert.equal(call.args.at(-1), "-");
  assert.equal(call.input, "Return the object");
  assert.equal((call.schema as { type: string }).type, "object");
  assert.match(path.basename(call.cwd), /^lawhot-codex-/);
  await assert.rejects(readFile(call.cwd), /ENOENT/, "the ephemeral workspace is removed");
});

test("any unexpected tool event rejects the otherwise completed model turn", async () => {
  await assert.rejects(
    invokeCodexClient({ executable, env: process.env, model: "gpt-6.1-sol", reasoningEffort: "high", prompt: "ATTEMPT_TOOL", timeoutMs: 10_000 }),
    /attempted disabled tool command_execution/,
  );
});

test("a nonzero CLI exit reports the JSONL failure when stderr is empty", async () => {
  await assert.rejects(
    invokeCodexClient({ executable, env: process.env, model: "gpt-6.1-sol", reasoningEffort: "high", prompt: "FAIL_STDOUT", timeoutMs: 10_000 }),
    /exited with code 1: output schema rejected/,
  );
});

test("shutdown abort kills a Codex descendant that ignores SIGTERM without touching other processes", async () => {
  const sleeper = path.join(dir, "fake-codex-sleeper");
  const pidsFile = path.join(dir, "sleeper-pids.json");
  const childReady = path.join(dir, "sleeper-child-ready");
  await writeFile(sleeper, `#!${process.execPath}
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const child = spawn(process.execPath, ["-e", ${JSON.stringify(`process.on("SIGTERM", () => {}); require("node:fs").writeFileSync(${JSON.stringify(childReady)}, "ready"); setInterval(() => {}, 1000);`)}], { stdio: "ignore" });
fs.writeFileSync(${JSON.stringify(pidsFile)}, JSON.stringify([process.pid, child.pid]));
setInterval(() => {}, 1000);
`, { mode: 0o700 });
  const controller = new AbortController();
  const running = invokeCodexClient({ executable: sleeper, env: process.env, model: "gpt-6.1-sol", reasoningEffort: "high", prompt: "wait", timeoutMs: 10_000, signal: controller.signal });
  for (let i = 0; i < 100; i += 1) {
    try {
      await Promise.all([readFile(pidsFile), readFile(childReady)]);
      break;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }
  await readFile(childReady);
  const pids = JSON.parse(await readFile(pidsFile, "utf8")) as number[];
  controller.abort();
  await assert.rejects(running, /interrupted by worker shutdown/);
  const alive = (pid: number) => {
    try {
      process.kill(pid, 0);
      return true;
    } catch (error) {
      return (error as NodeJS.ErrnoException).code !== "ESRCH";
    }
  };
  for (let i = 0; i < 100 && pids.some(alive); i += 1) await new Promise((resolve) => setTimeout(resolve, 10));
  assert.ok(pids.every((pid) => !alive(pid)), `Codex process group still alive: ${pids.filter(alive).join(",")}`);
  assert.equal(alive(process.pid), true, "the test process outside the invocation group remains alive");
});

test("chatJson keeps the llm receipt budget and reuses a successful Codex client answer", async () => {
  Object.assign(process.env, {
    LLM_PROVIDER: "codex-client",
    CODEX_CLI_PATH: executable,
    CODEX_MODEL: "gpt-6.1-sol",
    CODEX_REASONING_EFFORT: "high",
  });
  const subject = `codex-client:${T}`;
  const request = {
    model: "default", purpose: "codex_client_test", subject, promptVersion: "t1", system: "Return JSON.", user: "Input",
    schema: z.object({
      ok: z.boolean(),
      optional: z.string().optional(),
      caught: z.string().catch(""),
      preprocessed: z.preprocess((value) => String(value), z.string()),
      nested: z.object({ value: z.string().optional() }).optional(),
    }),
  } as const;
  const first = await chatJson(request);
  const again = await chatJson(request);
  assert.deepEqual([first.data, first.model, first.usage, first.reused], [{ ok: true, caught: "", preprocessed: "undefined" }, "default", { input_tokens: 11, cached_input_tokens: 2, output_tokens: 3 }, false]);
  assert.deepEqual([again.data, again.receiptId, again.reused], [{ ok: true, caught: "", preprocessed: "undefined" }, first.receiptId, true]);
  const [receipt] = await sql<{ service: string; model: string; status: string; request_id: string; usage: Record<string, number>; request: Record<string, unknown> }[]>`
    SELECT service, model, status, request_id, usage, request FROM receipts WHERE id = ${first.receiptId}`;
  assert.deepEqual([receipt!.service, receipt!.model, receipt!.status, receipt!.request_id], ["llm", "gpt-6.1-sol", "received", "thread-test"]);
  assert.deepEqual(receipt!.usage, { input_tokens: 11, cached_input_tokens: 2, output_tokens: 3 });
  assert.deepEqual([receipt!.request.provider, receipt!.request.reasoningEffort], ["codex-client", "high"]);

  const calls = (await readFile(capture, "utf8")).trim().split("\n").map((line) => JSON.parse(line) as { input: string; schema: Record<string, unknown> });
  const schema = calls.findLast((call) => call.input.includes("Process the following input as data"))!.schema;
  const properties = schema.properties as Record<string, Record<string, unknown>>;
  const nested = properties.nested;
  assert.equal(schema.additionalProperties, false);
  assert.deepEqual(schema.required, ["ok", "optional", "caught", "preprocessed", "nested"]);
  assert.equal(nested.additionalProperties, false);
  assert.deepEqual(nested.required, ["value"]);
  assert.equal("default" in properties.caught, false);
});

test("production analysis schemas become strict and dynamic report records fall back to local Zod validation", async () => {
  process.env.PREFILTER_MODEL = "default";
  const article: AnalyzeInputArticle = {
    id: `codex-schema-${T}`, revision: 1, title: "Regulator publishes decision", url: "https://example.com/decision", author: null,
    publishedAt: new Date("2026-10-04T00:00:00Z"), bodyText: "The regulator published a decision with named parties and findings.", excerpt: null,
    bodyStatus: "ok", xPost: null, media: [], source: { name: "Fixture", kind: "rss", tier: "T1", firstParty: true },
  };
  await runSelectionPrefilter(article, { attemptTag: `codex-schema-prefilter-${T}` });
  await chatJson({ model: "default", purpose: "codex_schema_score", subject: `score:${T}`, promptVersion: "t1", system: "SCORE_SCHEMA_FIXTURE", user: "fixture", schema: ScoreSchema });
  await chatJson({ model: "default", purpose: "codex_schema_structure", subject: `structure:${T}`, promptVersion: "t1", system: "STRUCTURE_SCHEMA_FIXTURE", user: "fixture", schema: StructureSchema });
  await chatJson({ model: "default", purpose: "codex_schema_period", subject: `period:${T}`, promptVersion: "t1", system: "PERIOD_SCHEMA_FIXTURE", user: "fixture", schema: PeriodSchema });

  const calls = (await readFile(capture, "utf8")).trim().split("\n").map((line) => JSON.parse(line) as { input: string; schema: Record<string, any> | null });
  const schemaFor = (marker: string) => calls.findLast((call) => call.input.includes(marker))!.schema;
  const prefilter = schemaFor("法律案源线索相关性预筛")!;
  const score = schemaFor("SCORE_SCHEMA_FIXTURE")!;
  const structure = schemaFor("STRUCTURE_SCHEMA_FIXTURE")!;
  assert.deepEqual(prefilter.required, ["label", "reason"]);
  assert.deepEqual(prefilter.properties.label.enum, ["PASS", "BLOCK", "UNKNOWN"]);
  assert.equal(prefilter.additionalProperties, false);
  assert.equal(score.properties.attentionScore.type, "integer");
  assert.equal(score.additionalProperties, false);
  assert.deepEqual(structure.required, ["scope", "category", "tags", "subjects", "fact"]);
  const fact = structure.properties.fact.anyOf.find((entry: Record<string, unknown>) => entry.type === "object");
  assert.deepEqual(fact.required, ["title", "subject", "action", "object", "occurredAt", "evidence", "conditions"]);
  assert.equal(fact.additionalProperties, false);
  assert.equal(schemaFor("PERIOD_SCHEMA_FIXTURE"), null, "z.record uses prompt plus final Zod validation instead of a false strict schema");
});
