// Run after `npm run build -w @aihot/web`. Exercises the production SSR routes against a synthetic
// local API so the list wording and item JSON-LD are checked as readers and crawlers receive them.
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import type { PoolResponse, SiteItemDetail } from "@aihot/contracts/site";

const discoveredAt = "2026-10-06T01:10:00.000Z";
const publishedAt = "2026-10-05T08:30:00.000Z";

function item(id: "unknown" | "known"): SiteItemDetail {
  return {
    id,
    title: id === "unknown" ? "原文日期未知的破产公告" : "原文日期已知的监管公告",
    originalTitle: null,
    summary: "用于日期语义回归的公开资料。",
    reason: "测试资料",
    source: { name: "公开来源" },
    links: { original: `https://example.com/${id}` },
    publishedAt: id === "known" ? publishedAt : null,
    discoveredAt,
    timelineAt: id === "known" ? publishedAt : discoveredAt,
    category: id === "unknown" ? "bankruptcy-restructuring" : "regulatory-compliance",
    tags: [],
    score: 80,
    selected: true,
    channel: "news",
    story: null,
    x: null,
    readingMode: "summary-only",
    author: null,
    body: null,
    outline: [],
    relatedStories: [],
    topics: [],
    indexable: true,
    markdownAvailable: false,
    group: null,
    hasTranslation: false,
    bodyLanguage: "zh",
  };
}

const items = [item("unknown"), item("known")];
const pool: PoolResponse = {
  filters: { channel: "all", category: null, tag: null, q: null, tab: "time" },
  items,
  page: 1,
  pageCount: 1,
  total: items.length,
  todayCount: 1,
  freshness: discoveredAt,
};

let web: ChildProcess;
let origin = "";
let logs = "";
const api = createServer((req, res) => {
  const pathname = new URL(req.url!, "http://api.local").pathname;
  res.setHeader("Content-Type", "application/json");
  if (pathname === "/api/site/meta") return res.end(JSON.stringify({ changelogVersion: null }));
  if (pathname === "/api/site/pool") return res.end(JSON.stringify(pool));
  const match = /^\/api\/site\/items\/(unknown|known)$/.exec(pathname);
  if (match) return res.end(JSON.stringify(item(match[1] as "unknown" | "known")));
  res.statusCode = 404;
  return res.end(JSON.stringify({ code: "not_found" }));
});

before(async () => {
  api.listen(0, "127.0.0.1");
  await once(api, "listening");
  web = spawn(process.execPath, [fileURLToPath(new URL("../server.ts", import.meta.url))], {
    env: { ...process.env, WEB_PORT: "0", API_BASE_URL: `http://127.0.0.1:${(api.address() as AddressInfo).port}` },
    stdio: ["ignore", "pipe", "pipe"],
  });
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`web did not start: ${logs}`)), 15_000);
    web.on("exit", () => { clearTimeout(timeout); reject(new Error(`web exited: ${logs}`)); });
    web.stderr!.on("data", (chunk) => { logs += String(chunk); });
    web.stdout!.on("data", (chunk) => {
      logs += String(chunk);
      const match = logs.match(/"msg":"web started","port":(\d+)/);
      if (match) {
        origin = `http://127.0.0.1:${match[1]}`;
        clearTimeout(timeout);
        resolve();
      }
    });
  });
});

after(async () => {
  if (web && web.exitCode === null) {
    web.kill("SIGTERM");
    await once(web, "exit");
  }
  api.closeAllConnections();
  await new Promise<void>((resolve) => api.close(() => resolve()));
});

function newsArticle(html: string): Record<string, unknown> {
  const scripts = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)];
  for (const script of scripts) {
    const parsed = JSON.parse(script[1]!) as Record<string, unknown> | Array<Record<string, unknown>>;
    const values = Array.isArray(parsed) ? parsed : [parsed];
    const article = values.find((value) => value["@type"] === "NewsArticle");
    if (article) return article;
  }
  assert.fail("NewsArticle JSON-LD not found");
}

test("the all feed labels a missing original date and its collection time", async () => {
  const response = await fetch(`${origin}/all`);
  assert.equal(response.status, 200, logs);
  const html = await response.text();
  assert.match(html, /原文日期未知的破产公告/);
  assert.match(html, /原文发布时间未知 · 收录/);
});

test("an unknown original date is explicit and omitted from NewsArticle datePublished", async () => {
  const response = await fetch(`${origin}/items/unknown`);
  assert.equal(response.status, 200, logs);
  const html = await response.text();
  assert.match(html, /原文发布时间未知/);
  assert.match(html, />收录</);
  const article = newsArticle(html);
  assert.equal("datePublished" in article, false);
  assert.equal("dateModified" in article, false);
});

test("a known original date remains the NewsArticle publication date", async () => {
  const response = await fetch(`${origin}/items/known`);
  assert.equal(response.status, 200, logs);
  const html = await response.text();
  assert.doesNotMatch(html, /原文发布时间未知/);
  const article = newsArticle(html);
  assert.equal(article.datePublished, publishedAt);
  assert.equal(article.dateModified, publishedAt);
});
