// ChatGPT-authenticated Codex CLI adapter. It runs one stateless, tool-free inference in an empty
// read-only workspace and returns only the final assistant message plus the CLI's reported usage.
import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { shutdownSignal } from "../lib/shutdown.ts";
import { ProviderRejectedError, type CallOutcome } from "./receipts.ts";

const MAX_STDOUT_BYTES = 4 * 1024 * 1024;
const MAX_STDERR_BYTES = 1024 * 1024;
const REASONING_EFFORTS = new Set(["low", "medium", "high", "xhigh", "max", "ultra"]);

interface CodexEvent {
  type?: string;
  thread_id?: string;
  usage?: Record<string, unknown>;
  item?: { type?: string; text?: string; message?: string };
  error?: { message?: string } | string;
}

export interface CodexClientOptions {
  model: string;
  reasoningEffort: string;
  prompt: string;
  timeoutMs: number;
  outputSchema?: unknown;
  executable?: string;
  signal?: AbortSignal;
  /** Test seam for a fake executable. Production intentionally passes only a small env allowlist. */
  env?: NodeJS.ProcessEnv;
}

export interface CodexClientResult extends CallOutcome {
  response: {
    id: string;
    model: string;
    provider: "codex-client";
    choices: Array<{ message: { content: string }; finish_reason: "stop" }>;
    usage: Record<string, unknown>;
  };
  requestId: string;
  usage: Record<string, unknown>;
  cost: null;
}

function safeEnvironment(): NodeJS.ProcessEnv {
  const names = [
    "PATH", "HOME", "CODEX_HOME", "TMPDIR", "TMP", "TEMP", "LANG", "LC_ALL",
    "SSL_CERT_FILE", "SSL_CERT_DIR", "HTTPS_PROXY", "HTTP_PROXY", "ALL_PROXY", "NO_PROXY",
  ];
  return Object.fromEntries(names.flatMap((name) => process.env[name] === undefined ? [] : [[name, process.env[name]]])) as NodeJS.ProcessEnv;
}

function checkedModel(model: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/.test(model)) throw new ProviderRejectedError("Invalid CODEX_MODEL", null, false);
  return model;
}

function checkedEffort(effort: string): string {
  if (!REASONING_EFFORTS.has(effort)) throw new ProviderRejectedError("Invalid CODEX_REASONING_EFFORT", null, false);
  return effort;
}

function eventError(event: CodexEvent): string | null {
  if (typeof event.error === "string") return event.error;
  return event.error?.message ?? null;
}

function parseEvent(line: string): CodexEvent {
  try {
    return JSON.parse(line) as CodexEvent;
  } catch {
    throw new Error("Codex CLI returned invalid JSONL");
  }
}

function disabledTool(event: CodexEvent): string | null {
  if (!event.type?.startsWith("item.") || !event.item?.type) return null;
  return ["agent_message", "reasoning", "error"].includes(event.item.type) ? null : event.item.type;
}

function failureFromEvents(stdout: string): string | null {
  let failure: string | null = null;
  for (const line of stdout.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const event = parseEvent(line);
    if (event.item?.type === "error") failure = event.item.message ?? "Codex CLI emitted an error item";
    if (event.type === "turn.failed" || event.type === "error") failure = eventError(event) ?? event.type;
  }
  return failure;
}

function parseEvents(stdout: string): { threadId: string; content: string; usage: Record<string, unknown> } {
  let threadId = "";
  let content = "";
  let usage: Record<string, unknown> | null = null;
  let failure: string | null = null;
  let toolAttempt: string | null = null;
  for (const line of stdout.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const event = parseEvent(line);
    if (event.type === "thread.started" && typeof event.thread_id === "string") threadId = event.thread_id;
    if (event.type === "item.completed" && event.item?.type === "agent_message" && typeof event.item.text === "string") content = event.item.text;
    if (event.item?.type === "error") failure = event.item.message ?? "Codex CLI emitted an error item";
    else toolAttempt ??= disabledTool(event);
    if (event.type === "turn.completed" && event.usage && typeof event.usage === "object") usage = event.usage;
    if (event.type === "turn.failed" || event.type === "error") failure = eventError(event) ?? event.type;
  }
  if (failure) throw new Error(`Codex CLI failed: ${failure.slice(0, 500)}`);
  // Tools are disabled in argv as the primary control. Treat any unexpected tool event as an unknown
  // paid outcome anyway: the model request ran, but its result is not safe input to the application.
  if (toolAttempt) throw new Error(`Codex CLI attempted disabled tool ${toolAttempt}`);
  if (!threadId || !usage || !content) throw new Error("Codex CLI ended without a completed response, usage, and request id");
  return { threadId, content, usage };
}

export async function invokeCodexClient(options: CodexClientOptions): Promise<CodexClientResult> {
  const model = checkedModel(options.model);
  const effort = checkedEffort(options.reasoningEffort);
  const workspace = await mkdtemp(path.join(os.tmpdir(), "lawhot-codex-"));
  const schemaPath = path.join(workspace, "output-schema.json");
  try {
    if (options.outputSchema !== undefined) await writeFile(schemaPath, JSON.stringify(options.outputSchema), { mode: 0o600 });
    const args = [
      "exec",
      "--ignore-user-config",
      "--ephemeral",
      "--skip-git-repo-check",
      "--sandbox", "read-only",
      "--json",
      "--model", model,
      "--config", `model_reasoning_effort=${JSON.stringify(effort)}`,
      "--config", "model_reasoning_summary=\"none\"",
      "--config", "hide_agent_reasoning=true",
      "--config", "show_raw_agent_reasoning=false",
      "--config", "forced_login_method=\"chatgpt\"",
      "--config", "web_search=\"disabled\"",
      "--config", "features.shell_tool=false",
      "--config", "features.unified_exec=false",
      "--config", "features.shell_snapshot=false",
      "--config", "features.multi_agent=false",
      "--config", "features.apps=false",
      "--config", "features.hooks=false",
      "--config", "features.goals=false",
      "--config", "features.memories=false",
      "--config", "features.plugins=false",
      "--config", "features.remote_plugin=false",
      "--config", "features.image_generation=false",
      // Codex CLI 0.160 exposes view_image as a stable feature. Current documentation names the
      // equivalent setting tools.view_image; the feature form is the one this installed client accepts.
      "--config", "features.view_image=false",
      ...(options.outputSchema === undefined ? [] : ["--output-schema", schemaPath]),
      "-",
    ];

    const { stdout, stderr, code, signal } = await new Promise<{ stdout: string; stderr: string; code: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
      const child = spawn(options.executable ?? process.env.CODEX_CLI_PATH ?? "codex", args, {
        cwd: workspace,
        env: options.env ?? safeEnvironment(),
        shell: false,
        detached: process.platform !== "win32",
        stdio: ["pipe", "pipe", "pipe"],
      });
      let stdout = "";
      let stderr = "";
      let settled = false;
      let timedOut = false;
      let aborted = false;
      let protocolViolation: Error | null = null;
      let stdoutRemainder = "";
      let killTimer: NodeJS.Timeout | undefined;
      let timer: NodeJS.Timeout | undefined;
      const signal = options.signal ?? shutdownSignal.signal;
      const kill = (kind: NodeJS.Signals) => {
        if (!child.pid) return;
        if (process.platform !== "win32") {
          try {
            process.kill(-child.pid, kind);
            return;
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "ESRCH") child.kill(kind);
          }
        } else child.kill(kind);
      };
      const terminate = () => {
        if (killTimer) return;
        kill("SIGTERM");
        killTimer = setTimeout(() => kill("SIGKILL"), 1_000);
        killTimer.unref();
      };
      const onAbort = () => {
        aborted = true;
        terminate();
      };
      const finish = (fn: () => void) => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        if (killTimer) clearTimeout(killTimer);
        signal.removeEventListener("abort", onAbort);
        fn();
      };
      const failSize = (stream: "stdout" | "stderr") => {
        kill("SIGKILL");
        finish(() => reject(new Error(`Codex CLI ${stream} exceeded its limit`)));
      };
      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => {
        stdout += chunk;
        if (Buffer.byteLength(stdout) > MAX_STDOUT_BYTES) failSize("stdout");
        stdoutRemainder += chunk;
        const lines = stdoutRemainder.split(/\r?\n/);
        stdoutRemainder = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const tool = disabledTool(parseEvent(line));
            if (tool) {
              protocolViolation = new Error(`Codex CLI attempted disabled tool ${tool}`);
              terminate();
              break;
            }
          } catch (error) {
            protocolViolation = error as Error;
            terminate();
            break;
          }
        }
      });
      child.stderr.on("data", (chunk: string) => {
        stderr += chunk;
        if (Buffer.byteLength(stderr) > MAX_STDERR_BYTES) failSize("stderr");
      });
      child.on("error", (error: NodeJS.ErrnoException) => finish(() => {
        if (error.code === "ENOENT") reject(new ProviderRejectedError("Codex CLI executable was not found", null, false));
        else reject(error);
      }));
      child.on("close", (code, signal) => {
        // The direct CLI may exit on SIGTERM before descendants that ignore it. Its process-group id
        // remains addressable while those descendants live, so close must finish the exact group
        // before finish clears the delayed escalation timer.
        if (aborted || timedOut || protocolViolation) kill("SIGKILL");
        finish(() => {
          if (aborted) reject(new Error("Codex CLI interrupted by worker shutdown"));
          else if (timedOut) reject(new Error(`Codex CLI timed out after ${options.timeoutMs}ms`));
          else if (protocolViolation) reject(protocolViolation);
          else resolve({ stdout, stderr, code, signal });
        });
      });
      timer = setTimeout(() => {
        timedOut = true;
        terminate();
      }, options.timeoutMs);
      signal.addEventListener("abort", onAbort, { once: true });
      if (signal.aborted) onAbort();
      child.stdin.on("error", (error) => {
        if (aborted || timedOut || protocolViolation) return;
        protocolViolation = error;
        terminate();
      });
      child.stdin.end(options.prompt);
    });

    if (code !== 0 || signal) {
      const failure = failureFromEvents(stdout);
      const detail = stderr.trim().slice(-1000);
      throw new Error(`Codex CLI exited ${signal ? `with signal ${signal}` : `with code ${code}`}${failure ? `: ${failure.slice(0, 500)}` : detail ? `: ${detail}` : ""}`);
    }
    const parsed = parseEvents(stdout);
    const response = {
      id: parsed.threadId,
      model,
      provider: "codex-client" as const,
      choices: [{ message: { content: parsed.content }, finish_reason: "stop" as const }],
      usage: parsed.usage,
    };
    return { response, requestId: parsed.threadId, usage: parsed.usage, cost: null };
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
}
