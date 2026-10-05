// Read-only evidence snapshot. The output stays in ignored local data, never in the repository.
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { config } from "@aihot/backend/config";
import { closeDb, sql } from "@aihot/backend/db";
import { matchLead } from "../modules/leads/rules.ts";
import type { PoolResponse } from "@aihot/contracts/site";

const api = process.env.API_BASE_URL ?? "http://127.0.0.1:3001";
const checkedDate = process.argv[2] ?? new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" }).format(new Date());
if (!/^\d{4}-\d{2}-\d{2}$/.test(checkedDate) || !Number.isFinite(Date.parse(checkedDate)) || new Date(checkedDate).toISOString().slice(0, 10) !== checkedDate) throw new Error("Expected a valid YYYY-MM-DD date");
const output = path.join(config.dataDir, `live-${checkedDate.replaceAll("-", "")}`, "validation.json");
try {
  const [sources, material, processing, publications, receipts, models, schedules, heartbeats, duplicateUrls, samples] = await Promise.all([
    sql`SELECT s.id,s.interval_minutes,s.enabled,s.last_fetch_at,s.next_fetch_at,s.health,
        count(a.id)::int AS materials,min(a.published_at) AS oldest,max(a.published_at) AS newest
        FROM sources s LEFT JOIN articles a ON a.source_id=s.id GROUP BY s.id ORDER BY s.id`,
    sql`SELECT count(*)::int AS total,count(*) FILTER(WHERE backfill)::int AS backfill,
        count(*) FILTER(WHERE body_status='ok')::int AS body_ok,count(*) FILTER(WHERE body_status='unconfirmed')::int AS body_unconfirmed,
        count(*) FILTER(WHERE (published_at AT TIME ZONE 'Asia/Shanghai')::date=${checkedDate}::date)::int AS published_today FROM articles`,
    sql`SELECT processing_state,count(*)::int AS count FROM articles GROUP BY processing_state`,
    sql`SELECT eligible,selected,count(*)::int AS count FROM publications GROUP BY eligible,selected`,
    sql`SELECT service,purpose,status,count(*)::int AS count FROM receipts GROUP BY service,purpose,status ORDER BY purpose,status`,
    sql`SELECT model,count(*)::int AS requests,count(usage)::int AS with_usage,
        sum((usage->>'input_tokens')::bigint) AS input_tokens,sum((usage->>'output_tokens')::bigint) AS output_tokens
        FROM receipts WHERE service='llm' GROUP BY model`,
    sql`SELECT name,cron,timezone FROM pgboss.schedule ORDER BY name`,
    sql`SELECT key,value FROM settings WHERE key LIKE 'heartbeat.%' ORDER BY key`,
    sql`SELECT url,count(*)::int AS count FROM articles GROUP BY url HAVING count(*)>1`,
    sql`SELECT p.article_id,p.title,p.summary,p.reason,p.category,p.tags,p.score,p.published_at,a.backfill,a.body_status,
        a.excerpt,p.url FROM publications p JOIN articles a ON a.id=p.article_id
        WHERE p.eligible AND p.visibility='public' ORDER BY p.published_at DESC LIMIT 8`,
  ]);
  const endpoints: Record<string, unknown> = {};
  for (const name of ["timeline?limit=40", "pool", "topics", "hot", "reports/daily"]) {
    const response = await fetch(`${api}/api/site/${name}`);
    if (!response.ok) throw new Error(`${name}: HTTP ${response.status}`);
    endpoints[name] = await response.json();
  }
  const pool = endpoints.pool as PoolResponse;
  const leadMatches = pool.items.flatMap(item => matchLead(item).map(match => ({ id: item.id, title: item.title, practice: match.practice, reason: match.reason })));
  const snapshot = { checkedDate, checkedAt: new Date().toISOString(), sources, material, processing, publications, receipts, models, schedules, heartbeats, duplicateUrls, samples, leadMatches, endpoints };
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, JSON.stringify(snapshot, null, 2), { mode: 0o600 });
  console.log(JSON.stringify({ output, material, processing, publications, models, leadMatchCountFirstPage: leadMatches.length }));
} finally { await closeDb(); }
