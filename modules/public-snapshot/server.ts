import { defineServerModule } from "@aihot/backend/modules";
import { sql } from "@aihot/backend/db";
import { exportPublicSnapshot } from "./export.ts";
import { publishSnapshot } from "./publish.ts";

export async function publishPublicEdition() {
  if (process.env.PUBLIC_PAGES_ENABLED !== "true") return { skipped: "disabled" };
  // A pending public candidate is not a completed publication. Leave the previous version intact
  // and let the next scheduled run follow the engine's processing/grouping jobs.
  const [pending] = await sql<{ count: number }[]>`
    SELECT count(*)::int AS count FROM articles a
    LEFT JOIN sources s ON s.id=a.source_id
    WHERE a.processing_state='new' OR
      (a.processing_state='analyzed' AND a.grouping_status='pending' AND s.participation_mode='editorial'
       AND EXISTS(SELECT 1 FROM publications p WHERE p.article_id=a.id AND p.selection_candidate AND p.eligible AND p.visibility='public'))`;
  if (pending.count) return { deferred: "processing", pending: pending.count };
  return publishSnapshot(await exportPublicSnapshot(new Date()));
}

export const publicSnapshotModule = defineServerModule({
  name: "public-snapshot",
  schedules: [{ name: "pages.publish", cron: "*/15 * * * *", missed: "once", when: () => process.env.PUBLIC_PAGES_ENABLED === "true", run: publishPublicEdition }],
});
