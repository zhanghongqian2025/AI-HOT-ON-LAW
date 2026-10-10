import "../../../tests/setup.ts";
import assert from "node:assert/strict";
import { after, test } from "node:test";
import http from "node:http";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { config } from "@aihot/backend/config";
import { installModules } from "@aihot/backend/modules";
import { extractPageBody } from "@aihot/backend/content/extract";
import { pdfAttachmentUrls, extractPdfAttachment } from "../pdf-attachments.ts";
import { sql, closeDb } from "@aihot/backend/db";
import { stopBoss } from "@aihot/backend/jobs/queue";
import { collectSource } from "@aihot/backend/sources/collect";

const dir = await mkdtemp(path.join(os.tmpdir(), "law-pdf-test-"));
const executable = path.join(dir, "python-fixture");
const previous = process.env.PDF_PYTHON_PATH;
let payload = Buffer.from("%PDF-local-fixture");
let requests = 0;
const server = http.createServer((req, res) => {
  requests++;
  if (req.url === "/listing") { res.setHeader("content-type", "text/html"); res.end('<li><a href="/article">Official PDF notice</a><time>2026-10-01</time></li>'); }
  else if (req.url === "/article") { res.setHeader("content-type", "text/html"); res.end(html()); }
  else res.end(payload);
});
await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
const html = (links = '<a href="/download?filename=guide.pdf">附件</a>') => `<div class="notice"><p>修订指南2026年10月30日起施行，旧指南同时废止。</p>${links}</div>`;
config.allowPrivateNetworkFetch = true;
installModules([{ name: "pdf-test", extractAttachment: extractPdfAttachment }]);
after(async () => { server.close(); installModules([]); if (previous === undefined) delete process.env.PDF_PYTHON_PATH; else process.env.PDF_PYTHON_PATH = previous; await rm(dir, { recursive: true }); await stopBoss(); await closeDb(); });
async function parser(pages: unknown[]) {
  const answer = JSON.stringify({ pages }).replaceAll("'", "'\\''");
  await writeFile(executable, `#!/bin/sh\n/bin/cat >/dev/null\nprintf '%s' '${answer}'\n`, { mode: 0o700 });
  process.env.PDF_PYTHON_PATH = executable;
}

test("download query links retain announcement dates, every page and final-page pledge evidence", async () => {
  await parser(["登记审查及撤销程序的真实规则。".repeat(8), "尾部许可备案与质押变更注销证据。".repeat(8)]);
  const got = await extractPageBody(html(), `${base}/article`, undefined, ".notice");
  assert.ok(got); assert.equal(got.via, "attachment");
  assert.match(got.text, /2026年10月30日/); assert.match(got.text, /旧指南同时废止/);
  assert.match(got.text, /附件第2\/2页/); assert.match(got.text, /质押变更注销/);
  assert.equal(got.attachments?.[0]?.pages, 2);
  assert.equal(got.attachments?.[0]?.sha256.length, 64);
  assert.deepEqual(pdfAttachmentUrls(html(), `${base}/article`, ".notice"), [`${base}/download?filename=guide.pdf`]);
});

test("blank/scanned pages and oversized text cannot fall back to a readable pointer", async () => {
  for (const pages of [["只有首页有正文且满足至少二十字符的最低限制条件。", ""], ["x".repeat(160_001)]]) {
    await parser(pages);
    assert.equal(await extractPageBody(html(), `${base}/article`, undefined, ".notice"), null);
  }
});

test("multiple and cross-origin attachments are refused before requests; missing parser does not imply full text", async () => {
  const before = requests;
  assert.equal(await extractPdfAttachment(html('<a href="/a.pdf">一</a><a href="/b.pdf">二</a>'), `${base}/article`, ".notice"), null);
  assert.equal(await extractPdfAttachment(html('<a href="https://example.com/a.pdf">一</a>'), `${base}/article`, ".notice"), null);
  delete process.env.PDF_PYTHON_PATH;
  assert.equal(await extractPdfAttachment(html(), `${base}/article`, ".notice"), null);
  assert.equal(requests, before);
});

test("HTML error responses, parser failures and invalid output cannot become full text", async () => {
  await parser(["正文有效内容至少二十个字符且不得借用网页错误正文。"]);
  payload = Buffer.from("<html>access denied</html>");
  assert.equal(await extractPdfAttachment(html(), `${base}/article`, ".notice"), null);
  payload = Buffer.from("%PDF-local-fixture");
  process.env.PDF_PYTHON_PATH = path.join(dir, "missing");
  assert.equal(await extractPdfAttachment(html(), `${base}/article`, ".notice"), null);
  await parser([23]);
  assert.equal(await extractPdfAttachment(html(), `${base}/article`, ".notice"), null);
});

test("ordinary pages without PDF keep the existing body path; known-page refresh only asks for attachments", async () => {
  const ordinary = `<html><head><title>Official notice</title></head><body><article><div class="notice"><h1>官方通知</h1><p>${"This official announcement has substantive paragraphs, no attached document, and complete source text. ".repeat(30)}</p></div></article></body></html>`;
  assert.equal(await extractPdfAttachment(ordinary, `${base}/article`, ".notice"), undefined);
  assert.ok(await extractPageBody(ordinary, `${base}/article`, undefined, ".notice"));
  assert.equal(await extractPageBody(ordinary, `${base}/article`, undefined, ".notice", true), null);
});

test("normal collection refreshes a known PDF once, preserves source/discovery dates and stops repeat revisions", async () => {
  const id = "pdf-collection-test";
  const sourceConfig = { url: `${base}/listing`, itemSelector: "li", titleSelector: "a", publishedAtSelector: "time", detail: { maxFetches: 1, pdfAttachmentSelector: ".notice" } };
  await sql`INSERT INTO sources(id,name,kind,config,cursor) VALUES (${id},'Local PDF source','web_list',${sql.json(sourceConfig)},${sql.json({initializedAt:new Date().toISOString()})})`;
  await parser(["完整有效的第一版登记及许可规定正文。".repeat(10)]);
  assert.equal((await collectSource(id)).created, 1);
  const [before] = await sql`SELECT id,revision,published_at,discovered_at,raw FROM articles WHERE source_id=${id}`;
  assert.equal(before!.raw.attachments[0].pages, 1);
  await parser(["完整有效的第二版质押变更注销规定正文。".repeat(10)]);
  payload = Buffer.from("%PDF-second-fixture");
  assert.equal((await collectSource(id)).revised, 1);
  const [changed] = await sql`SELECT revision,published_at,discovered_at,body_text FROM articles WHERE id=${before!.id}`;
  assert.equal(changed!.revision, before!.revision + 1);
  assert.deepEqual(changed!.published_at, before!.published_at);
  assert.deepEqual(changed!.discovered_at, before!.discovered_at);
  assert.match(changed!.body_text, /质押变更注销/);
  assert.equal((await collectSource(id)).revised, 0);
  await parser([""]);
  assert.equal((await collectSource(id)).revised, 0);
  const [retained] = await sql`SELECT revision,body_text FROM articles WHERE id=${before!.id}`;
  assert.equal(retained!.revision, changed!.revision);
  assert.equal(retained!.body_text, changed!.body_text);
  const [run] = await sql`SELECT detail FROM fetch_runs WHERE source_id=${id} ORDER BY id DESC LIMIT 1`;
  assert.equal(run!.detail.attachmentChecks.unconfirmed, 1);
  assert.equal((await sql`SELECT id FROM receipts`).length, 0);
});
