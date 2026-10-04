import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import http from "node:http";
import path from "node:path";
import { after, test } from "node:test";
import { config, REPO_ROOT } from "@aihot/backend/config";
import { assertSupportedConfig } from "@aihot/backend/sources/config-keys";
import { fetchJsonList } from "@aihot/backend/sources/json-list";
import { fetchDetail, fromHtml } from "@aihot/backend/sources/web-list";
import type { SourceRow } from "@aihot/backend/sources/types";

interface SeedSource {
  id: string;
  name: string;
  kind: SourceRow["kind"];
  config: Record<string, unknown>;
  tier: string;
  participation_mode: SourceRow["participation_mode"];
  interval_minutes: number;
  site_fulltext: boolean;
}

const seeded = (JSON.parse(readFileSync(path.join(REPO_ROOT, "industry/sources.json"), "utf8")) as { sources: SeedSource[] }).sources;
const byId = (id: string) => seeded.find((source) => source.id === id)!;
const row = (source: SeedSource): SourceRow => ({ ...source, config: source.config, first_party: source.tier === "T1", enabled: true, cursor: null, fail_count: 0 });

// Captured from the named official list pages on 2026-10-04. These small fixtures retain the
// actual repeated node, relative/absolute article path and date DOM without checking network in CI.
const LISTS: Record<string, string> = {
  "supreme-court-news": `<div class="lf_news"><div class="content"><div class="sec_list"><ul>
    <li><a href="/zixun/xiangqing/513401.html">“东方之花”向世界绚丽绽放</a><i class="date">2026-09-30</i></li>
    <li><a href="/zixun/xiangqing/513261.html">提级管辖：让正义在更高维度实现</a><i class="date">2026-09-29</i></li>
  </ul></div></div><div class="content"><div class="sec_list"><ul><li><a href="/zixun/xiangqing/other.html">地方法院新闻</a><i class="date">2026-09-30</i></li></ul></div></div></div>`,
  "cnipa-announcements": `<dl class="pub_xlist"><dd class="show"><ul class="pub_xlist_m pub_slam">
    <li><a href="https://www.cnipa.gov.cn/art/2026/9/30/art_74_208392.html">关于发布修订后的《集成电路布图设计审查与行政裁决指南》的公告（第695号）</a><span>2026-09-30</span></li>
  </ul></dd></dl>`,
  "mee-enforcement": `<div class="ywgz_xj"><div class="bd mobile_list"><div><ul><li><a href="../../xxgk/a.html">行政处理</a><span class="date">2025-12-19</span></li></ul></div><div><ul>
    <li><a href="../../ywgz/hjyj/yjxy/202603/t20260319_1147303.shtml">江西省寻乌县鑫鼎汇矿业有限公司违法排污事件调查结果</a><span class="date">2026-03-19</span></li>
  </ul></div></div></div>`,
  "chinajob-labor-relations": `<div class="list_con_left"><ul>
    <li><div><h4><a href="/c/2026-09-18/606362.shtml">中国人力资源服务业发展向新向优</a></h4></div></li>
    <li><div><h4><a href="https://mp.weixin.qq.com/s/example">民营企业人员如何评职称</a></h4></div></li>
    <li><div><h4><a href="/c/2026-08-07/583498.shtml">抓好“四化”建设推进调解仲裁事业高质量发展</a></h4></div></li>
  </ul></div>`,
};

const EXPECTED = {
  "supreme-court-news": { count: 2, url: "https://www.court.gov.cn/zixun/xiangqing/513401.html", date: "2026-09-30T00:00:00.000Z" },
  "cnipa-announcements": { count: 1, url: "https://www.cnipa.gov.cn/art/2026/9/30/art_74_208392.html", date: "2026-09-30T00:00:00.000Z" },
  "mee-enforcement": { count: 1, url: "https://www.mee.gov.cn/ywgz/hjyj/yjxy/202603/t20260319_1147303.shtml", date: "2026-03-19T00:00:00.000Z" },
  "chinajob-labor-relations": { count: 2, url: "https://chinajob.mohrss.gov.cn/c/2026-09-18/606362.shtml", date: "2026-09-18T00:00:00.000Z" },
} as const;

test("official legal source configs parse their verified list DOM and article paths", () => {
  for (const source of seeded) {
    assert.equal(source.interval_minutes, 1440);
    assert.equal(source.site_fulltext, false);
    assertSupportedConfig(source.kind, source.config);
    if (source.kind !== "web_list") continue;
    const expected = EXPECTED[source.id as keyof typeof EXPECTED];
    assert.ok(expected, `missing fixture for ${source.id}`);
    const items = fromHtml(LISTS[source.id]!, String(source.config.url), row(source));
    assert.equal(items.length, expected.count, source.id);
    assert.equal(items[0]?.url, expected.url, source.id);
    assert.equal(items[0]?.publishedAt?.toISOString(), expected.date, source.id);
  }
});

// Captured from one fetched detail page per source on 2026-10-04. The local server proves the configured
// detail rules, including metadata fallback, without making tests depend on the live sites.
const DETAILS: Record<string, string> = {
  "/court": `<div class="detail"><div class="title">“东方之花”向世界绚丽绽放<br />——全国法院涉外商事海事实质解纷工作纪实</div><li>发布时间：2026-09-30 08:38:29</li></div>`,
  "/cnipa": `<head><meta name="pubdate" content="2026-09-30 20:09"/><meta name="description" content="现将修订后的《集成电路布图设计审查与行政裁决指南》予以发布，自2026年10月30日起施行。"/></head><h1>关于发布修订后指南的公告</h1>`,
  "/mee": `<head><meta name="PubDate" content="2026-03-19 10:35:00" /></head><h2 class="neiright_Title">环境事件调查结果</h2>`,
  "/chinajob": `<div class="detail_con"><h4>抓好“四化”建设推进调解仲裁事业高质量发展</h4><div class="detail_info"><div class="date">2026.08.07</div></div></div>`,
};

const CSRC_JSON = JSON.stringify({ data: { results: [
  { manuscriptId: "7661080", title: "中国证券监督管理委员会行政处罚决定书", url: "//www.csrc.gov.cn/csrc/c101928/c7661080/content.shtml", publishedTimeStr: "2026-09-01 16:38:00" },
  { manuscriptId: "7659511", title: "中国证券监督管理委员会行政处罚决定书", url: "//www.csrc.gov.cn/csrc/c101928/c7659511/content.shtml", publishedTimeStr: "2026-09-01 15:47:00" },
] } });

const server = http.createServer((req, res) => {
  if (req.url === "/csrc-api") {
    res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
    res.end(CSRC_JSON);
    return;
  }
  const body = DETAILS[req.url ?? ""];
  res.writeHead(body ? 200 : 404, { "content-type": "text/html; charset=utf-8" });
  res.end(body ?? "not found");
});
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
const local = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
const previousPrivateFetch = config.allowPrivateNetworkFetch;
config.allowPrivateNetworkFetch = true;
after(() => {
  config.allowPrivateNetworkFetch = previousPrivateFetch;
  return new Promise<void>((resolve) => server.close(() => resolve()));
});

test("verified detail rules preserve the real publication timestamps", async () => {
  const checks = [
    ["supreme-court-news", "/court", "2026-09-30T00:38:29.000Z"],
    ["cnipa-announcements", "/cnipa", "2026-09-30T12:09:00.000Z"],
    ["mee-enforcement", "/mee", "2026-03-19T02:35:00.000Z"],
    ["chinajob-labor-relations", "/chinajob", "2026-08-06T16:00:00.000Z"],
  ] as const;
  for (const [id, url, expected] of checks) {
    const got = await fetchDetail(`${local}${url}`, row(byId(id)), { date: true, title: id === "supreme-court-news" || id === "chinajob-labor-relations", summary: id === "cnipa-announcements", body: false });
    assert.equal(got.publishedAt?.toISOString(), expected, id);
    if (id === "supreme-court-news") assert.match(got.title ?? "", /全国法院涉外商事海事/);
    if (id === "cnipa-announcements") assert.equal(got.summary, "现将修订后的《集成电路布图设计审查与行政裁决指南》予以发布，自2026年10月30日起施行。");
    if (id === "chinajob-labor-relations") assert.match(got.title ?? "", /调解仲裁事业/);
  }
});

test("CSRC current penalty JSON maps official article URLs and timestamps", async () => {
  const source = byId("csrc-penalties");
  const localSource = row({ ...source, config: { ...source.config, url: `${local}/csrc-api` } });
  const items = await fetchJsonList(localSource);
  assert.equal(items.length, 2);
  assert.equal(items[0]?.url, "https://www.csrc.gov.cn/csrc/c101928/c7661080/content.shtml");
  assert.equal(items[0]?.publishedAt?.toISOString(), "2026-09-01T08:38:00.000Z");
  assert.deepEqual(items[0]?.raw, { externalId: "7661080" });
});
