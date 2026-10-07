import { tag } from "./setup.ts";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { after, before, test } from "node:test";
import { config } from "@aihot/backend/config";
import { closeDb, sql } from "@aihot/backend/db";
import { extractArticleBody, extractHtmlBody } from "@aihot/backend/content/extract";
import { upsertMaterial } from "@aihot/backend/content/materials";
import { queueProcessing } from "@aihot/backend/jobs/content";
import { QUEUES, stopBoss } from "@aihot/backend/jobs/queue";

const text = "本公告通知行政办事机构变更办公地址并明确启用时间，请相关申请人核对官方办事通知。".repeat(4);
assert.ok(text.length >= 100 && text.length < 200);
const page = (content = text) => `<html><head><title>短通知</title></head><body><nav>首页</nav><div class="article-content">${content}</div></body></html>`;
const selector = ".article-content";

test("short notices require an explicit unique source container; the general threshold stays unchanged", () => {
  assert.equal(extractHtmlBody(page(), "https://example.com/notice"), null);
  const body = extractHtmlBody(page(), "https://example.com/notice", selector);
  assert.equal(body?.text, text);
  assert.equal(body?.via, "selector");
  assert.equal(extractHtmlBody(page("简短菜单"), "https://example.com/notice", selector), null);
  assert.equal(extractHtmlBody(page(), "https://example.com/notice", ".missing"), null);
  assert.equal(extractHtmlBody(page() + page(), "https://example.com/notice", selector), null);
});

test("attachment notices and linked excerpts cannot stand in for complete regulations", () => {
  for (const extra of [
    '<a href="/module/download/downfile.jsp?filename=rules.pdf">完整文件</a>',
    '<a href="/related">其他正文</a>',
    "附件：完整指南另行下载",
  ]) assert.equal(extractHtmlBody(page(text + extra), "https://example.com/notice", selector), null);
});

const sourceId = `short-notice-${tag()}`;
const server = createServer((_req, res) => { res.writeHead(200, { "content-type": "text/html" }); res.end(page()); });
let base = "";
before(async () => {
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  config.allowPrivateNetworkFetch = true;
  await sql`INSERT INTO sources(id,name,kind,participation_mode,config)
    VALUES(${sourceId},'Short official notice','web_list','editorial',${sql.json({ detail: { shortNoticeSelector: selector } })})`;
});
after(async () => { server.close(); await stopBoss(); await closeDb(); });

test("repairing an old notice creates one revision and normal analysis job without changing any dates", async () => {
  const { articleId } = await upsertMaterial({ sourceId, url: `${base}/notice`, title: "原短通知", via: "fetch",
    publishedAt: new Date("2026-08-27T00:00:00Z"), bodyStatus: "unconfirmed", backfill: "first-import" });
  const before = (await sql`SELECT published_at,discovered_at,timeline_at,revision FROM articles WHERE id=${articleId}`)[0]!;
  await sql`UPDATE articles SET processing_state='blocked' WHERE id=${articleId}`;
  assert.equal(await extractArticleBody(articleId), "ok");
  const after = (await sql`SELECT published_at,discovered_at,timeline_at,revision,processing_state,body_status FROM articles WHERE id=${articleId}`)[0]!;
  assert.equal(after.revision, before.revision + 1);
  assert.equal(after.processing_state, "new");
  assert.equal(after.body_status, "ok");
  for (const field of ["published_at", "discovered_at", "timeline_at"]) assert.deepEqual(after[field], before[field]);
  const jobId = await queueProcessing(articleId);
  const job = (await sql`SELECT name,data FROM pgboss.job WHERE id=${jobId}`)[0]!;
  assert.equal(job.name, QUEUES.analyze);
  assert.equal(job.data.articleId, articleId);
  assert.equal(await extractArticleBody(articleId), "skipped");
  assert.equal((await sql`SELECT revision FROM articles WHERE id=${articleId}`)[0]!.revision, after.revision);
  assert.equal((await sql`SELECT id FROM receipts WHERE subject=${`article:${articleId}`}`).length, 0);
});
