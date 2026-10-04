import assert from "node:assert/strict";
import test from "node:test";
import type { FeedItemSummary, SiteItemDetail } from "@aihot/contracts/site";
import { matchLead, safeSourceUrl, toLeadCandidate } from "../rules.ts";

function item(overrides: Partial<FeedItemSummary> = {}): FeedItemSummary {
  return {
    id: "item-1",
    title: "公司公告",
    summary: null,
    reason: null,
    source: { name: "测试来源" },
    publishedAt: "2026-10-03T03:00:00.000Z",
    timelineAt: "2026-10-03T03:00:00.000Z",
    category: null,
    tags: [],
    score: null,
    selected: false,
    channel: "news",
    x: null,
    ...overrides,
  };
}

function detail(original: string): SiteItemDetail {
  return {
    ...item(),
    originalTitle: null,
    links: { original },
    discoveredAt: "2026-10-03T04:00:00.000Z",
    story: null,
    readingMode: "summary-only",
    author: null,
    body: null,
    x: null,
    outline: [],
    relatedStories: [],
    topics: [],
    indexable: false,
    markdownAvailable: false,
    group: null,
    hasTranslation: false,
    bodyLanguage: "zh",
  };
}

test("从明确关键词生成待核验业务候选", () => {
  const matches = matchLead(item({ title: "某公司启动破产重整，债权申报开始" }));
  assert.equal(matches.length, 1);
  assert.equal(matches[0]?.practice, "insolvency");
  assert.deepEqual(matches[0]?.matchedTerms, ["破产重整", "债权申报"]);
  assert.match(matches[0]?.reason ?? "", /可能涉及破产法律服务需求/);
  assert.match(matches[0]?.reason ?? "", /人工核验/);
});

test("业务类别只返回所选范围", () => {
  const report = item({ summary: "企业同时涉及欠薪与数据合规整改" });
  assert.deepEqual(matchLead(report, "labor").map((match) => match.practice), ["labor"]);
  assert.deepEqual(matchLead(report, "compliance").map((match) => match.practice), ["compliance"]);
});

test("没有明确法律业务关键词时拒绝生成候选", () => {
  assert.deepEqual(matchLead(item({ title: "某公司发布年度业绩报告", summary: "营收同比增长" })), []);
});

test("培训与活动营销标题不生成案源候选", () => {
  assert.deepEqual(matchLead(item({ title: "劳动仲裁培训课程报名通知" })), []);
  assert.deepEqual(matchLead(item({ title: "企业数据合规论坛会议宣传" })), []);
  assert.deepEqual(matchLead(item({ title: "破产重整培训课程报名通知" })), []);
  assert.deepEqual(matchLead(item({ title: "专利侵权论坛报名通知" })), []);
});

test("正式程序通知不被活动噪声规则遮蔽", () => {
  assert.equal(matchLead(item({ title: "劳动仲裁开庭通知" }))[0]?.practice, "labor");
  assert.equal(matchLead(item({ title: "市场监管局行政处罚听证通知" }))[0]?.practice, "compliance");
});

test("候选保留发布与发现时间，事件发生时间明确为未知", () => {
  const report = item({ title: "某公司因商标侵权被起诉" });
  const match = matchLead(report)[0]!;
  const candidate = toLeadCandidate(report, match, detail("https://court.example.test/notices/1"));
  assert.equal(candidate.sourceUrl, "https://court.example.test/notices/1");
  assert.equal(candidate.publishedAt, "2026-10-03T03:00:00.000Z");
  assert.equal(candidate.discoveredAt, "2026-10-03T04:00:00.000Z");
  assert.equal(candidate.occurrenceAt, null);
  assert.equal(candidate.status, "pending_review");
});

test("无效或带凭据的原始来源地址不对外暴露", () => {
  assert.equal(safeSourceUrl("javascript:alert(1)"), null);
  assert.equal(safeSourceUrl("https://user:secret@example.test/report"), null);
  assert.equal(safeSourceUrl("not a url"), null);
  assert.equal(safeSourceUrl("https://example.test/report"), "https://example.test/report");
});
