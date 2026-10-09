import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { after, before, test } from "node:test";
import { closeDb, sql } from "@aihot/backend/db";
import { prepareDocumentEvidence, type DocumentCoverage } from "@aihot/backend/editorial/long-document";
import type { AnalyzeInputArticle } from "@aihot/backend/editorial/input";
import { ModelOutputError } from "@aihot/backend/providers/llm";
import { stopBoss } from "@aihot/backend/jobs/queue";
import { pointModels, stub, tag } from "./setup.ts";

const captured: Array<{ articleId: string; revision: number; chunk: number; blocks: Array<{ id: string; start: number; end: number; text: string }> }> = [];
let answerMode: "valid" | "unknown" | "duplicate" | "whitespace" | "fail-third-once" | "ten" = "valid";
let thirdFailed = false;

const provider = await stub((_hit, req) => {
  const request = JSON.parse(req.body) as { messages: Array<{ role: string; content: string }> };
  const input = JSON.parse(request.messages.findLast((message) => message.role === "user")!.content) as typeof captured[number];
  captured.push(input);
  const nonblank = input.blocks.filter((block) => /\S/u.test(block.text));
  let blockIds: string[];
  if (answerMode === "unknown") blockIds = ["B999999"];
  else if (answerMode === "duplicate") blockIds = [nonblank[0]!.id, nonblank[0]!.id];
  else if (answerMode === "whitespace") blockIds = [input.blocks.find((block) => !/\S/u.test(block.text))!.id];
  else if (answerMode === "fail-third-once" && input.chunk === 3 && !thirdFailed) {
    thirdFailed = true;
    blockIds = ["B999999"];
  } else if (answerMode === "ten") blockIds = nonblank.slice(0, 10).map((block) => block.id);
  else {
    const substantiveTail = nonblank.find((block) => block.text.includes("许可与质押"));
    blockIds = [nonblank[0]!.id, substantiveTail?.id ?? nonblank.at(-1)!.id].filter((id, index, ids) => ids.indexOf(id) === index);
  }
  return { choices: [{ message: { content: JSON.stringify({ blockIds }) }, finish_reason: "stop" }] };
});

before(() => pointModels(provider.url, ["qwen3.8-flash"]));
after(async () => {
  await provider.close();
  await stopBoss();
  await closeDb();
});

const article = (bodyText: string, id = `long-${tag()}`): AnalyzeInputArticle => ({
  id, revision: 3, title: "第695号指南", url: "https://example.com/guide", author: null,
  publishedAt: new Date("2026-09-01T00:00:00Z"), discoveredAt: new Date("2026-10-01T00:00:00Z"),
  bodyText, excerpt: null, bodyStatus: "ok", xPost: null, media: [],
  source: { name: "一手机关", kind: "web_list", tier: "T1", firstParty: true },
});

const sha = (text: string) => createHash("sha256").update(text).digest("hex");

function assertComplete(body: string, coverage: DocumentCoverage) {
  assert.equal(coverage.complete, true);
  assert.equal(coverage.offsetUnit, "utf16");
  assert.equal(coverage.bodyChars, body.length);
  assert.equal(coverage.bodySha256, sha(body));
  assert.equal(coverage.segments[0]!.start, 0);
  assert.equal(coverage.segments.at(-1)!.end, body.length);
  assert.equal(coverage.segments.map((segment) => body.slice(segment.start, segment.end)).join(""), body);
  for (let i = 0; i < coverage.segments.length; i += 1) {
    const segment = coverage.segments[i]!;
    assert.equal(segment.index, i + 1);
    assert.equal(segment.sha256, sha(body.slice(segment.start, segment.end)));
    assert.ok(segment.end - segment.start <= 20_000, `segment ${segment.index} exceeds the 20k bound`);
    if (i) assert.equal(coverage.segments[i - 1]!.end, segment.start);
    assert.ok(!(segment.end < body.length && /[\uD800-\uDBFF]/u.test(body[segment.end - 1]!) && /[\uDC00-\uDFFF]/u.test(body[segment.end]!)));
  }
}

test("a short document is returned by identity without a model call", async () => {
  captured.length = 0;
  const input = article("x".repeat(60_000));
  const result = await prepareDocumentEvidence(input);
  assert.equal(result.article, input);
  assert.equal(result.coverage, null);
  assert.equal(captured.length, 0);
});

test("79k is continuously covered and evidence includes the tail after 67k", async () => {
  answerMode = "valid";
  captured.length = 0;
  const tail = "许可与质押的尾部实质规则";
  const body = `${"A".repeat(67_000)}\n\n${tail}\n${"Z".repeat(11_980)}`;
  const input = article(body);
  const result = await prepareDocumentEvidence(input);
  assert.ok(result.coverage);
  assertComplete(body, result.coverage);
  assert.equal(result.article.bodyText, body);
  assert.equal(result.article.bodyStatus, "ok");
  assert.deepEqual(result.article.documentEvidence && {
    characters: result.article.documentEvidence.characters,
    segments: result.article.documentEvidence.segments,
  }, { characters: body.length, segments: result.coverage.segments.length });
  assert.match(result.article.documentEvidence!.text, /许可与质押/u);
  assert.ok(captured.some((request) => request.blocks.some((block) => block.text.includes(tail))), "the model receives the tail verbatim");
  const calls = captured.length;
  const reused = await prepareDocumentEvidence(input);
  assert.equal(reused.coverage!.reused, true);
  assert.deepEqual(reused.coverage!.receiptIds, result.coverage.receiptIds);
  assert.equal(captured.length, calls, "a complete retry reuses every received segment answer");
});

test("receipt identity binds identical text to its article and revision", async () => {
  answerMode = "valid";
  captured.length = 0;
  const body = "i".repeat(60_001);
  const input = article(body);
  const result = await prepareDocumentEvidence(input);
  assert.ok(result.coverage);
  const calls = captured.length;

  const same = await prepareDocumentEvidence(input);
  assert.equal(same.coverage!.reused, true);
  assert.deepEqual(same.coverage!.receiptIds, result.coverage.receiptIds);
  assert.equal(captured.length, calls, "the same article revision reuses every chunk receipt");

  const otherArticle = article(body);
  const other = await prepareDocumentEvidence(otherArticle);
  assert.equal(captured.length, calls + result.coverage.segments.length, "the same body on another article has its own receipts");
  assert.notDeepEqual(other.coverage!.receiptIds, result.coverage.receiptIds);
  assert.ok(captured.slice(calls).every((request) => request.articleId === otherArticle.id && request.revision === otherArticle.revision));

  const revised = { ...input, revision: input.revision + 1 };
  const revisedResult = await prepareDocumentEvidence(revised);
  assert.equal(captured.length, calls + result.coverage.segments.length * 2, "a new revision of the same article has its own receipts");
  assert.notDeepEqual(revisedResult.coverage!.receiptIds, result.coverage.receiptIds);
  assert.ok(captured.slice(calls + result.coverage.segments.length).every((request) => request.articleId === input.id && request.revision === revised.revision));
});

test("hard splits preserve surrogate pairs and every block has exact UTF-16 offsets", async () => {
  answerMode = "valid";
  captured.length = 0;
  const body = `${"a".repeat(19_999)}😀${"b".repeat(45_000)}`;
  const result = await prepareDocumentEvidence(article(body));
  assert.ok(result.coverage);
  assertComplete(body, result.coverage);
  const blocks = captured.flatMap((request) => request.blocks);
  assert.equal(blocks[0]!.start, 0);
  assert.equal(blocks.at(-1)!.end, body.length);
  assert.equal(blocks.map((block) => block.text).join(""), body);
  for (const block of blocks) {
    assert.ok(block.text.length <= 700);
    assert.equal(block.text, body.slice(block.start, block.end));
  }
});

test("a newline beginning exactly at the 20k target cannot push the segment past its bound", async () => {
  answerMode = "valid";
  captured.length = 0;
  const body = `${"n".repeat(20_000)}\n${"m".repeat(40_001)}`;
  const result = await prepareDocumentEvidence(article(body));
  assert.ok(result.coverage);
  assertComplete(body, result.coverage);
  assert.equal(result.coverage.segments[0]!.end, 20_000);
  assert.equal(result.coverage.segments.map((segment) => body.slice(segment.start, segment.end)).join(""), body);
});

for (const invalid of ["unknown", "duplicate", "whitespace"] as const) test(`rejects ${invalid} block selections and marks the response unusable`, async () => {
  answerMode = invalid;
  captured.length = 0;
  const body = invalid === "whitespace" ? `${" ".repeat(700)}${"x".repeat(60_001)}` : "x".repeat(60_001);
  await assert.rejects(prepareDocumentEvidence(article(body), { attemptTag: `invalid-${invalid}-${tag()}` }), ModelOutputError);
  const [receipt] = await sql<{ status: string }[]>`SELECT status FROM receipts WHERE purpose = 'long_document_chunk' ORDER BY id DESC LIMIT 1`;
  assert.equal(receipt!.status, "failed");
});

test("a third-segment failure reuses the first two received receipts on retry", async () => {
  answerMode = "fail-third-once";
  thirdFailed = false;
  captured.length = 0;
  const input = article("r".repeat(61_000));
  await assert.rejects(prepareDocumentEvidence(input), ModelOutputError);
  assert.equal(captured.length, 3);
  const firstTwo = await sql<{ id: number }[]>`
    SELECT id FROM receipts WHERE purpose = 'long_document_chunk' AND subject LIKE ${`article:${input.id}@3#chunk:%`} AND status = 'received' ORDER BY id`;
  assert.equal(firstTwo.length, 2);
  const result = await prepareDocumentEvidence(input);
  assert.ok(result.coverage);
  assert.equal(result.coverage.reused, false, "the repaired third segment is fresh, even though earlier segments are reused");
  assert.deepEqual(result.coverage.receiptIds.slice(0, 2), firstTwo.map((row) => row.id));
  assert.equal(captured.length, 5, "the retry reuses segments one and two, repairs three, then processes the previously unreached fourth segment");
});

test("fails instead of slicing when selected evidence cannot fit the 60k pack", async () => {
  answerMode = "ten";
  captured.length = 0;
  await assert.rejects(prepareDocumentEvidence(article("p".repeat(159_999))), /evidence pack exceeds 60000 UTF-16 characters/);
  assert.equal(captured.length, 8);
});

test("more than eight 20k segments fails before any model call", async () => {
  answerMode = "valid";
  captured.length = 0;
  await assert.rejects(prepareDocumentEvidence(article("q".repeat(160_001))), /more than 8 segments/);
  assert.equal(captured.length, 0);
});
