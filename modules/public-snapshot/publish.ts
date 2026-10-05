import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, readFile, readdir, rm, cp } from "node:fs/promises";
import path from "node:path";
import type { PublicSnapshot } from "./types.ts";
import { writePublicSite } from "./render.ts";
import { publicSnapshotContentHash } from "./export.ts";

const execute = promisify(execFile);
export const PAGES_REPOSITORY = "https://github.com/zhanghongqian2025/AI-HOT-ON-LAW.git";
export const PAGES_URL = "https://zhanghongqian2025.github.io/AI-HOT-ON-LAW/";
const files = new Set(["index.html", "app.js", "app.css", "data.json", "logo.svg", "favicon.svg", ".nojekyll"]);

async function git(cwd: string, ...args: string[]): Promise<string> {
  try {
    const { stdout } = await execute("/usr/bin/git", args, { cwd, timeout: 90_000, maxBuffer: 2_000_000, env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } });
    return stdout.trim();
  } catch {
    // Credential helpers may print private diagnostics. Keep only the failed operation in job history.
    throw new Error(`Pages git ${args[0]} failed; inspect local GitHub authentication or branch state`);
  }
}

export const snapshotHash = publicSnapshotContentHash;

/** A dedicated artifact checkout; the application's main branch and private state are never staged. */
export async function publishSnapshot(snapshot: PublicSnapshot, stateRoot = path.resolve(".data/pages")) {
  const checkout = path.join(stateRoot, "repository");
  const build = path.join(stateRoot, "build");
  await mkdir(checkout, { recursive: true, mode: 0o700 });
  try { await readFile(path.join(checkout, ".git/config")); }
  catch {
    await git(checkout, "init", "--initial-branch=gh-pages");
    await git(checkout, "remote", "add", "origin", PAGES_REPOSITORY);
  }
  if (await git(checkout, "remote", "get-url", "origin") !== PAGES_REPOSITORY || await git(checkout, "branch", "--show-current") !== "gh-pages") throw new Error("Refusing unrelated Pages checkout");
  await git(checkout, "config", "credential.helper", "!/opt/homebrew/bin/gh auth git-credential");
  await git(checkout, "config", "user.name", "AI HOT-ON-LAW publication");
  await git(checkout, "config", "user.email", "196587317+zhanghongqian2025@users.noreply.github.com");
  if (await git(checkout, "status", "--porcelain")) throw new Error("Pages checkout has unfinished local changes; preserve and inspect it before publishing");
  const branches = await git(checkout, "ls-remote", "--heads", "origin", "gh-pages");
  if (branches) {
    await git(checkout, "fetch", "origin", "gh-pages");
    let hasHead = false;
    try { await git(checkout, "rev-parse", "--verify", "HEAD"); hasHead = true; } catch { /* first fetch */ }
    if (hasHead) await git(checkout, "merge", "--ff-only", "FETCH_HEAD");
    else await git(checkout, "reset", "--hard", "FETCH_HEAD");
  }
  for (const entry of await readdir(checkout, { withFileTypes: true })) {
    if (entry.name === ".git") continue;
    if (!files.has(entry.name) || !entry.isFile()) throw new Error("Refusing unexpected file in public artifact branch");
  }
  await rm(build, { recursive: true, force: true });
  await writePublicSite(build, snapshot);
  for (const entry of await readdir(build, { withFileTypes: true })) {
    if (!files.has(entry.name) || !entry.isFile()) throw new Error("Public site contains a file outside the publication allowlist");
  }
  // Preserve snapshot time when the business content has not changed. Assets still update normally.
  try {
    const previous = JSON.parse(await readFile(path.join(checkout, "data.json"), "utf8")) as PublicSnapshot;
    if (snapshotHash(previous) === snapshotHash(snapshot)) {
      const { writeFile } = await import("node:fs/promises");
      await writeFile(path.join(build, "data.json"), JSON.stringify(previous, null, 2) + "\n");
    }
  } catch { /* first snapshot */ }
  for (const name of await readdir(checkout)) if (name !== ".git") await rm(path.join(checkout, name));
  for (const name of await readdir(build)) await cp(path.join(build, name), path.join(checkout, name));
  await git(checkout, "add", "--all", "--", ".");
  const changed = Boolean(await git(checkout, "diff", "--cached", "--name-only"));
  if (changed) await git(checkout, "commit", "-m", `Publish public snapshot ${snapshot.generatedAt.slice(0, 10)} ${snapshotHash(snapshot).slice(0, 8)}`);
  // Push even after a prior interrupted run committed locally but never reached GitHub.
  await git(checkout, "push", "origin", "HEAD:gh-pages");
  return { changed, commit: await git(checkout, "rev-parse", "HEAD"), contentHash: snapshotHash(snapshot), url: PAGES_URL };
}
