// Failure cases: automatic runs rewrite published issues; report/receipt commits split; empty gaps
// starve later daily/weekly/monthly issues or make a failed run look successful. All use a local model stub.
import { Reply, stub, tag } from "./setup.ts";
import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { closeDb, sql } from "@aihot/backend/db";
import { stopBoss } from "@aihot/backend/jobs/queue";
import { composeDaily, composeDueReports, composeWeekly, composeMonthly, dueDaily, dueMonthly, dueWeekly } from "@aihot/backend/reports/compose";

const T = tag();
const SOURCE = `report-recovery-${T}`;
const EMPTY_NOW = new Date(`${2200 + Math.floor(Math.random() * 500)}-02-02T03:00:00Z`);
const answer = async (user: string) => ({ title: user.slice(0, 100), leadParagraph: "导语", highlights: [1], headline: "本期进展", overview: "总述", themes: [{ heading: "主题", summary: "摘要", refs: [1] }] });
let providerFailure = false;
const provider = await stub(async (_hit, request) => providerFailure
  ? new Reply(503, { error: "temporary report provider outage" })
  : ({ choices: [{ message: { content: JSON.stringify(await answer(JSON.parse(request.body).messages.at(-1).content)) } }] }));
process.env.DEEPSEEK_BASE_URL = `${provider.url}/v1`;
process.env.DEEPSEEK_API_KEY = "test-key";
before(async () => {
  await sql`INSERT INTO sources (id, name, kind, tier) VALUES (${SOURCE}, 'Report recovery', 'rss', 'T1')`;
});
beforeEach(async () => {
  providerFailure = false;
  await sql`DELETE FROM reports`;
  await sql`DELETE FROM articles WHERE source_id = ${SOURCE}`;
});
after(async () => { await provider.close(); await stopBoss(); await closeDb(); });

async function item(at: string) {
  const id = `recovery-${tag()}`;
  await sql`INSERT INTO articles (id, source_id, identity_key, url, title, discovered_at, timeline_at)
    VALUES (${id}, ${SOURCE}, ${id}, 'https://example.com/report', ${id}, ${new Date(at)}, ${new Date(at)})`;
  await sql`INSERT INTO publications (article_id, title, source_id, channel, url, discovered_at, timeline_at, sort_at, eligible, selected, visible_after, visibility, score)
    VALUES (${id}, ${id}, ${SOURCE}, 'news', 'https://example.com/report', ${new Date(at)}, ${new Date(at)}, ${new Date(at)}, true, true, ${new Date(at)}, 'public', 90)`;
  return id;
}
const report = async (kind: string, key: string) => (await sql`SELECT content, revision, generated_at FROM reports WHERE kind = ${kind} AND key = ${key}`)[0];

test("automatic retries preserve all three published issue kinds; explicit corrections keep a revision", async () => {
  const id = await item("2024-02-01T12:00:00Z");
  for (const [kind, key, compose] of [
    ["daily", "2024-02-02", composeDaily], ["weekly", "2024-W05", composeWeekly], ["monthly", "2024-02", composeMonthly],
  ] as const) {
    await compose(key);
    const saved = await report(kind, key);
    const calls = provider.hits();
    await sql`UPDATE publications SET title = title || ' corrected' WHERE article_id = ${id}`;
    await compose(key);
    assert.deepEqual(await report(kind, key), saved, `${kind}: an automatic retry preserves the edition`);
    assert.equal(provider.hits(), calls, "no model request for an already published edition");
    await compose(key, "editor correction");
    assert.equal((await report(kind, key)).revision, 2);
    const [revision] = await sql`SELECT v.content FROM report_revisions v JOIN reports r ON r.id = v.report_id WHERE r.kind = ${kind} AND r.key = ${key}`;
    assert.deepEqual(revision.content, saved.content);
  }
});

test("report publication and its receipt commit together and recovery reuses the response", async () => {
  await item("2024-05-01T12:00:00Z");
  await composeDaily("2024-05-02");
  await sql.unsafe(`CREATE FUNCTION fail_report_receipt() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
    IF NEW.status = 'completed' AND NEW.purpose = 'report_weekly' THEN RAISE EXCEPTION 'receipt commit interrupted'; END IF;
    RETURN NEW; END $$;
    CREATE TRIGGER fail_report_receipt BEFORE UPDATE ON receipts FOR EACH ROW EXECUTE FUNCTION fail_report_receipt()`);
  try {
    await assert.rejects(composeWeekly("2024-W18"), /receipt commit interrupted/);
    assert.equal(await report("weekly", "2024-W18"), undefined);
  } finally {
    await sql.unsafe("DROP TRIGGER fail_report_receipt ON receipts; DROP FUNCTION fail_report_receipt()");
  }
  const calls = provider.hits();
  await composeWeekly("2024-W18");
  assert.equal(provider.hits(), calls);
  assert.equal((await report("weekly", "2024-W18")).revision, 1);
  assert.equal((await sql`SELECT status FROM receipts WHERE subject = 'report:weekly:2024-W18'`)[0]!.status, "completed");
});

test("scheduled empty windows skip without model calls or report rows", async () => {
  const calls = provider.hits();
  const result = await composeDueReports(EMPTY_NOW);
  assert.deepEqual(result, {
    generated: [],
    skipped: [
      { report: `daily:${dueDaily(EMPTY_NOW)}`, reason: "no_selected_items" },
      { report: `weekly:${dueWeekly(EMPTY_NOW)}`, reason: "no_daily_entries" },
      { report: `monthly:${dueMonthly(EMPTY_NOW)}`, reason: "no_daily_entries" },
    ],
    failed: [],
  });
  assert.equal(provider.hits(), calls);
  assert.equal(Number((await sql`SELECT count(*) AS count FROM reports`)[0]!.count), 0);
});

test("a skipped daily window is checked again and publishes after selected material arrives", async () => {
  const daily = dueDaily(EMPTY_NOW);
  await composeDueReports(EMPTY_NOW);
  await item(`${daily.slice(0, 8)}01T12:00:00Z`);
  const result = await composeDueReports(EMPTY_NOW);
  assert.ok(result.generated.includes(`daily:${daily}`));
  assert.deepEqual(result.failed, []);
  assert.ok(await report("daily", daily));
});

test("a scheduled provider failure is still thrown for retry", async () => {
  const early = await item("2024-01-22T12:00:00Z");
  await sql`INSERT INTO reports (kind, key, window_start, window_end, content, generated_at)
    VALUES ('daily', '2024-01-23', now(), now(), ${sql.json({ sections: [{ label: "行业动态", items: [{ itemId: early, title: early }] }] })}, now())`;
  providerFailure = true;
  await assert.rejects(composeDueReports(new Date("2024-02-02T03:00:00Z")), /reports: weekly:2024-W04, monthly:2024-01 failed/);
  assert.equal(await report("weekly", "2024-W04"), undefined);
  assert.equal(await report("monthly", "2024-01"), undefined);
});

test("empty older gaps cannot starve a later daily, weekly or monthly", async () => {
  // An older issue carried an item; the days after it are empty. Weeklies and monthlies are compiled from dailies.
  const early = await item("2024-01-22T12:00:00Z");
  await sql`INSERT INTO reports (kind, key, window_start, window_end, content, generated_at)
    VALUES ('daily', '2024-01-23', now(), now(), ${sql.json({ sections: [{ label: "行业动态", items: [{ itemId: early, title: early }] }] })}, now())`;
  await item("2024-02-01T12:00:00Z");
  const result = await composeDueReports(new Date("2024-02-02T03:00:00Z"));
  assert.deepEqual(result.failed, []);
  assert.ok(result.skipped.length > 0, "empty intervening dailies are visible as skips");
  for (const [kind, key] of [["daily", "2024-02-02"], ["weekly", "2024-W04"], ["monthly", "2024-01"]]) {
    assert.ok(await report(kind!, key!), `${kind} ${key} was recovered past the empty gaps`);
  }
});
