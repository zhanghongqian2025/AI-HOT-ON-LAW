// Project-owned macOS login services. Credentials remain in private local files.
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import { homedir } from "node:os";
import { createHash } from "node:crypto";
import path from "node:path";

const source = path.resolve(import.meta.dirname, "..");
if (existsSync(path.join(source, ".aihot-runtime.json"))) throw new Error("Run this launcher from the original checkout, not its staged runtime");
const action = process.argv[2] ?? "status";
if (!["install", "status", "stop", "start"].includes(action)) throw new Error("Usage: node scripts/local-services.ts install|status|stop|start");
if (process.platform !== "darwin" || !process.getuid) throw new Error("These services require a macOS user login session");
const domain = `gui/${process.getuid()}`;
const id = createHash("sha256").update(source).digest("hex").slice(0, 10);
const prefix = `com.aihotlaw.${id}`;
// LaunchAgents cannot inherit the editor's Documents permission. Use ordinary app-owned storage,
// retaining the checkout and its cold database copy; no system privacy permissions are changed.
const root = path.join(homedir(), "Library/Application Support/AI-HOT-ON-LAW", id);
const marker = path.join(root, ".aihot-runtime.json");
const dir = path.join(homedir(), "Library/LaunchAgents");
const logs = path.join(root, ".data/logs");
const pgBin = process.env.AIHOT_PG_BIN ?? "/opt/homebrew/opt/postgresql@17/bin";
const cluster = path.join(root, ".data/postgres");
const node = path.join(root, ".runtime/node");
const services = [
  { name: "postgres", args: [path.join(pgBin, "postgres"), "-D", cluster, "-h", "127.0.0.1", "-p", "55432"] },
  { name: "api", args: [node, `--env-file=${path.join(root, ".env")}`, path.join(root, "apps/api/src/main.ts")] },
  { name: "web", args: [node, `--env-file=${path.join(root, ".env")}`, path.join(root, "apps/web/server.ts")] },
  { name: "worker", args: [node, `--env-file=${path.join(root, ".env")}`, path.join(root, "apps/worker/src/main.ts")] },
];
const label = (name: string) => `${prefix}.${name}`;
const file = (name: string) => path.join(dir, `${label(name)}.plist`);
function ctl(args: string[], optional = false): string {
  try { return execFileSync("/bin/launchctl", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }); }
  catch (error) { if (optional) return "not loaded"; throw error; }
}
const escape = (s: string) => s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
const string = (s: string) => `<string>${escape(s)}</string>`;
function verifyOwner() {
  if (existsSync(root) && (!existsSync(marker) || JSON.parse(readFileSync(marker, "utf8")).source !== source)) throw new Error(`Refusing unowned runtime ${root}`);
  for (const s of services) {
    if (existsSync(file(s.name))) {
      const old = readFileSync(file(s.name), "utf8");
      if (!old.includes(string(root)) && !old.includes(string(source))) throw new Error(`Refusing unrelated service file ${file(s.name)}`);
    }
  }
}
function plist(name: string, args: string[]) {
  const env: Record<string, string> = { HOME: homedir(), PATH: `${path.dirname(node)}:${pgBin}:/usr/bin:/bin:/usr/sbin:/sbin`, LC_ALL: "en_US.UTF-8", NODE_ENV: "production", API_HOST: "127.0.0.1", WEB_HOST: "127.0.0.1" };
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key>${string(label(name))}
<key>ProgramArguments</key><array>${args.map(string).join("")}</array>
<key>WorkingDirectory</key>${string(root)}
<key>EnvironmentVariables</key><dict>${Object.entries(env).map(([k,v]) => `<key>${k}</key>${string(v)}`).join("")}</dict>
<key>RunAtLoad</key><true/><key>KeepAlive</key><true/><key>ThrottleInterval</key><integer>10</integer>
<key>ExitTimeOut</key><integer>240</integer>
<key>StandardOutPath</key>${string(path.join(logs, `${name}.log`))}
<key>StandardErrorPath</key>${string(path.join(logs, `${name}.error.log`))}
</dict></plist>\n`;
}

if (action === "status") {
  console.log(`runtime: ${root}`);
  for (const s of services) {
    const status = ctl(["print", `${domain}/${label(s.name)}`], true);
    console.log(`${label(s.name)}: ${status.match(/\bstate = (.+)/)?.[1] ?? "not loaded"}; pid=${status.match(/\bpid = (\d+)/)?.[1] ?? "-"}`);
  }
} else {
  verifyOwner();
  if (action === "install") {
    if (!existsSync(path.join(source, ".env"))) throw new Error("Create the project's .env first");
    if (!existsSync(path.join(source, "apps/web/build/server/index.js"))) throw new Error("Build the web application first");
    if (!existsSync(path.join(pgBin, "postgres"))) throw new Error("Set AIHOT_PG_BIN to PostgreSQL 17's bin directory");
    // Stop consumers before the database; re-install applies changed code and environment.
    for (const s of [...services].reverse()) ctl(["bootout", `${domain}/${label(s.name)}`], true);
    // bootout can return before the database's graceful shutdown has removed its PID file.
    const stopDeadline = Date.now() + 30_000;
    while (existsSync(path.join(cluster, "postmaster.pid")) && Date.now() < stopDeadline) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    const firstInstall = !existsSync(marker) || JSON.parse(readFileSync(marker, "utf8")).initialized !== true;
    const originalCluster = path.join(source, ".data/postgres");
    if (firstInstall && (!existsSync(path.join(originalCluster, "PG_VERSION")) || readFileSync(path.join(originalCluster, "PG_VERSION"), "utf8").trim() !== "17" || existsSync(path.join(originalCluster, "postmaster.pid")))) throw new Error("Stop the project's PostgreSQL 17 cluster before its first cold copy");
    if (existsSync(path.join(cluster, "postmaster.pid"))) throw new Error("Runtime PostgreSQL has not stopped; do not stage over a live cluster");
    mkdirSync(root, { recursive: true, mode: 0o700 });
    writeFileSync(marker, JSON.stringify({ source, initialized: !firstInstall }), { mode: 0o600 });
    // Delete removed code only within this proven staging tree. Excluded state/credentials and the
    // ownership marker are protected by rsync; the original checkout and cold copy are retained.
    execFileSync("/usr/bin/rsync", ["-a", "--delete", "--exclude=.git", "--exclude=.data", "--exclude=.env*", "--exclude=.omx", "--exclude=.runtime", "--exclude=.aihot-runtime.json", "--exclude=.DS_Store", `${source}/`, `${root}/`]);
    // rsync -a also copies the source root's mode; restore the private runtime boundary.
    chmodSync(root, 0o700);
    mkdirSync(path.dirname(node), { recursive: true, mode: 0o700 });
    copyFileSync(process.execPath, node); chmodSync(node, 0o700);
    copyFileSync(path.join(source, ".env"), path.join(root, ".env")); chmodSync(path.join(root, ".env"), 0o600);
    if (firstInstall) {
      mkdirSync(path.join(root, ".data"), { recursive: true, mode: 0o700 });
      execFileSync("/usr/bin/rsync", ["-a", `${source}/.data/`, `${root}/.data/`, "--exclude=runtime", "--exclude=logs", "--exclude=live-20261004", "--exclude=*.log"]);
    }
    if (readFileSync(path.join(cluster, "PG_VERSION"), "utf8").trim() !== "17") throw new Error("Expected runtime PostgreSQL 17");
    chmodSync(path.join(root, ".data"), 0o700);
    writeFileSync(marker, JSON.stringify({ source, initialized: true }), { mode: 0o600 });
    mkdirSync(dir, { recursive: true }); mkdirSync(logs, { recursive: true });
    for (const s of services) {
      writeFileSync(file(s.name), plist(s.name, s.args), { mode: 0o600 });
      execFileSync("/usr/bin/plutil", ["-lint", file(s.name)], { stdio: "inherit" });
    }
  } else if (action === "start" && (!existsSync(marker) || JSON.parse(readFileSync(marker, "utf8")).initialized !== true)) throw new Error("Complete this checkout's runtime installation first");
  if (action === "stop") {
    for (const s of [...services].reverse()) console.log(s.name, ctl(["bootout", `${domain}/${label(s.name)}`], true).trim());
  } else {
    for (const s of services) {
      if (ctl(["print", `${domain}/${label(s.name)}`], true) === "not loaded") ctl(["bootstrap", domain, file(s.name)]);
      else ctl(["kickstart", `${domain}/${label(s.name)}`]);
      console.log(`loaded ${label(s.name)}`);
    }
  }
}
