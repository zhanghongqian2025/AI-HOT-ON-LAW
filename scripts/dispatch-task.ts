// Explicit dispatch for an external local executor. Requires the manual worker to be running.
import { closeDb, sql } from "@aihot/backend/db";
import { getBoss, stopBoss } from "@aihot/backend/jobs/queue";

const allowed = new Set(["sources.schedule", "content.sweep", "content.translate", "hot.rank", "hot.snapshot", "stories.links", "reports.compose", "pages.publish"]);
const task = process.argv[2] ?? "";
try {
  if (!allowed.has(task)) throw new Error(`Expected one of: ${[...allowed].join(", ")}`);
  const [timers] = await sql`SELECT count(*)::int AS count FROM pgboss.schedule`;
  if (timers.count) throw new Error("Automatic schedules still registered; complete manual-mode migration first");
  const boss = await getBoss();
  const name = `cron.${task}`;
  if (!await boss.getQueue(name)) throw new Error(`Worker has not registered ${name}`);
  const id = await boss.send(name, {});
  console.log(JSON.stringify({ queue: name, queued: id }));
} finally { await stopBoss(); await closeDb(); }
