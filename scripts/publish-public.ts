// Manual requests use the same singleton worker queue as the scheduled publisher.
import { ensureQueue, getBoss, stopBoss } from "@aihot/backend/jobs/queue";
import { closeDb } from "@aihot/backend/db";

try {
  if (process.env.PUBLIC_PAGES_ENABLED !== "true") throw new Error("PUBLIC_PAGES_ENABLED must be true in the project's private local environment");
  await ensureQueue("cron.pages.publish", { policy: "singleton", retryLimit: 1, expireInSeconds: 3600 });
  const job = await (await getBoss()).send("cron.pages.publish", {});
  console.log(JSON.stringify({ queued: job, queue: "cron.pages.publish" }));
} finally { await stopBoss(); await closeDb(); }
