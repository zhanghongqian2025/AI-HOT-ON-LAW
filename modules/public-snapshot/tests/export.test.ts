import assert from "node:assert/strict";
import test from "node:test";
import type { FeedItemSummary, SiteItemDetail } from "@aihot/contracts/site";
import {
  buildPublicSnapshot,
  publicSnapshotContentHash,
  safePublicUrl,
  type PublicSnapshotReaders,
} from "../export.ts";

const asOf = new Date("2026-10-05T00:00:00.000Z");

function card(id: string, title: string, selected = false): FeedItemSummary {
  return {
    id,
    title,
    summary: `${title}摘要`,
    reason: selected ? "编辑精选理由" : null,
    source: { name: "官方来源" },
    publishedAt: "2024-02-03T00:00:00.000Z",
    timelineAt: "2024-02-04T00:00:00.000Z",
    category: "regulatory-compliance",
    tags: ["监管"],
    score: 88,
    selected,
    channel: "news",
    x: null,
  };
}

function detail(item: FeedItemSummary, url: string): SiteItemDetail {
  return {
    ...item,
    discoveredAt: "2024-02-04T00:00:00.000Z",
    links: { aihot: `/items/${item.id}`, original: url },
  } as unknown as SiteItemDetail;
}

function readers(): PublicSnapshotReaders {
  const first = card("lead-1", "企业因拖欠工资被责令整改", true);
  const second = card("plain-2", "行业例行通知");
  const unsafe = card("unsafe-3", "某事项通知");
  return {
    loadPool: async ({ page }: Parameters<PublicSnapshotReaders["loadPool"]>[0]) => ({
      filters: { channel: "all", category: null, tag: null, q: null, tab: "time" },
      items: page === 1 ? [first, second] : [second, unsafe],
      page: page ?? 1,
      pageCount: 2,
      total: 4,
      todayCount: 0,
      freshness: asOf.toISOString(),
    }),
    loadItemDetail: async (id: string) => {
      const item = [first, second, unsafe].find((candidate) => candidate.id === id);
      if (!item) return { kind: "not_found" } as const;
      return {
        kind: "found",
        item: detail(item, id === "unsafe-3" ? "http://127.0.0.1/private" : `https://example.gov.cn/${id}`),
        row: {},
      } as Awaited<ReturnType<PublicSnapshotReaders["loadItemDetail"]>>;
    },
    selectedSnapshot: async ({ page }: Parameters<PublicSnapshotReaders["selectedSnapshot"]>[0]) => ({
      schemaVersion: 1 as const,
      asOf: asOf.toISOString(),
      fields: "default" as const,
      cursor: "cursor",
      count: page ? 2 : 1,
      hasMore: page === null,
      nextPage: page === null ? "next" : null,
      items: page === null ? [{
        id: first.id,
        title: first.title,
        originalTitle: null,
        summary: first.summary,
        source: first.source,
        links: { aihot: "/items/lead-1", original: "https://example.gov.cn/lead-1" },
        publishedAt: first.publishedAt,
        discoveredAt: "2024-02-04T00:00:00.000Z",
        category: "policy",
        score: 88,
        selected: true,
        reason: first.reason,
        attribution: { name: "site", url: "/items/lead-1" },
      }] : [{
        id: "selected-old",
        title: "历史精选",
        originalTitle: null,
        summary: null,
        source: { name: "法院" },
        links: { aihot: "/items/selected-old", original: "https://court.gov.cn/old" },
        publishedAt: null,
        discoveredAt: "2020-01-01T00:00:00.000Z",
        category: null,
        score: 90,
        selected: true,
        reason: "历史理由",
        attribution: { name: "site", url: "/items/selected-old" },
      }, {
        id: first.id,
        title: first.title,
        originalTitle: null,
        summary: first.summary,
        source: first.source,
        links: { aihot: "/items/lead-1", original: "https://example.gov.cn/lead-1" },
        publishedAt: first.publishedAt,
        discoveredAt: "2024-02-04T00:00:00.000Z",
        category: "policy",
        score: 88,
        selected: true,
        reason: first.reason,
        attribution: { name: "site", url: "/items/lead-1" },
      }],
    }),
    hot: async () => ({ schemaVersion: 1 as const, count: 1, items: [{
      rank: 1,
      id: "lead-1",
      title: first.title,
      source: first.source,
      links: { aihot: "/items/lead-1", original: "https://example.gov.cn/lead-1", story: "/api/v1/stories/a" },
      sourceCount: 2,
      signalCount: 3,
      participantCount: 1,
      sourceNames: ["官方来源"],
      latestAt: "2024-02-04T00:00:00.000Z",
    }] }),
    dailies: async () => ({ schemaVersion: 1 as const, count: 1, items: [{
      date: "2024-02-04",
      generatedAt: "2024-02-05T00:00:00.000Z",
      leadTitle: "每日摘要",
      leadParagraph: "内部索引不应导出",
      links: { aihot: "/daily/2024-02-04" },
      attribution: { name: "site", url: "/daily/2024-02-04" },
    }] }),
    daily: async () => ({ schemaVersion: 1 as const, report: {
      date: "2024-02-04",
      generatedAt: "2024-02-05T00:00:00.000Z",
      windowStart: "2024-02-03T00:00:00.000Z",
      windowEnd: "2024-02-04T00:00:00.000Z",
      links: { aihot: "/daily/2024-02-04" },
      attribution: { name: "site", url: "/daily/2024-02-04" },
      lead: { title: "每日摘要", leadParagraph: "公开简介" },
      sections: [{ label: "监管", items: [{
        title: "公开事件",
        summary: "事件摘要",
        source: { name: "部委" },
        links: { aihot: "/items/x", original: "https://gov.cn/x" },
        attribution: { name: "site", url: "/items/x" },
      }] }],
      flashes: [],
    } }),
    periods: async (kind: "weekly" | "monthly") => ({ schemaVersion: 1 as const, count: 1, items: [{
      ...(kind === "weekly" ? { week: "2024-W05" } : { month: "2024-02" }),
      periodStart: "2024-01-29",
      periodEnd: "2024-02-04",
      generatedAt: "2024-02-05T00:00:00.000Z",
      headline: `${kind}摘要`,
      links: { aihot: `/${kind}/key` },
      attribution: { name: "site", url: `/${kind}/key` },
    }] }),
    period: async (kind: "weekly" | "monthly") => ({ schemaVersion: 1 as const, report: {
      ...(kind === "weekly" ? { week: "2024-W05" } : { month: "2024-02" }),
      periodStart: "2024-01-29",
      periodEnd: "2024-02-04",
      generatedAt: "2024-02-05T00:00:00.000Z",
      windowStart: "2024-01-29T00:00:00.000Z",
      windowEnd: "2024-02-04T00:00:00.000Z",
      links: { aihot: `/${kind}/key` },
      attribution: { name: "site", url: `/${kind}/key` },
      headline: `${kind}摘要`,
      overview: "周期简介",
      sections: [],
    } }),
    topics: async () => ({
      groups: [{ key: "direction", name: "业务方向", blurb: "公开索引" }],
      topics: [{
        slug: "compliance",
        name: "监管合规",
        group: "direction",
        definition: "监管事件",
        brand: { kind: "monogram", src: null, monogram: "监", raster: false },
        total: 2,
        recent: 1,
        indexable: true,
        latest: { title: first.title, at: "2024-02-04T00:00:00.000Z" },
      }],
    }),
    references: () => ({ filters: { q: "", practice: "all" }, items: [{
      id: "reference-1",
      title: "历史事件",
      summary: "人工整理摘要",
      sourceName: "官方机构",
      sourceUrl: "https://gov.cn/reference",
      publishedAt: "2020-01-01",
      eventAt: null,
      category: "compliance",
      reason: "供人工核验",
      checkedAt: "2026-10-04",
      status: "pending_review",
      referenceOnly: true,
      privateNote: "仅内部使用",
      token: "must-not-cross-public-boundary",
    }, {
      id: "reference-private",
      title: "不安全链接",
      summary: "不导出",
      sourceName: "本机",
      sourceUrl: "http://localhost/private",
      publishedAt: "2020-01-01",
      eventAt: null,
      category: "compliance",
      reason: "不导出",
      checkedAt: "2026-10-04",
      status: "pending_review",
      referenceOnly: true,
    }] }),
  } as unknown as PublicSnapshotReaders;
}

test("exports a paged, deduplicated and strictly public snapshot", async () => {
  const snapshot = await buildPublicSnapshot(asOf, readers());

  assert.deepEqual(Object.keys(snapshot).sort(), [
    "all", "generatedAt", "hot", "leadCandidates", "references", "reports", "schemaVersion", "selected", "site", "topics",
  ]);
  assert.deepEqual(snapshot.all.map(({ id }) => id), ["lead-1", "plain-2", "unsafe-3"]);
  assert.deepEqual(snapshot.selected.map(({ id }) => id), ["lead-1", "selected-old"]);
  assert.deepEqual(snapshot.selected.find(({ id }) => id === "lead-1")?.tags, ["监管"]);
  assert.deepEqual(snapshot.selected.find(({ id }) => id === "selected-old")?.tags, []);
  assert.equal(snapshot.all.find(({ id }) => id === "unsafe-3")?.originalUrl, null);
  assert.equal(snapshot.all[0]?.publishedAt, "2024-02-03T00:00:00.000Z");
  assert.deepEqual(Object.keys(snapshot.all[0]!).sort(), [
    "category", "discoveredAt", "id", "originalUrl", "publishedAt", "reason", "selected", "sourceName", "summary", "tags", "title",
  ]);

  assert.equal(snapshot.leadCandidates.length, 1);
  assert.equal(snapshot.leadCandidates[0]?.practice, "labor");
  assert.equal(snapshot.leadCandidates[0]?.status, "pending_review");
  assert.match(snapshot.leadCandidates[0]?.reason ?? "", /需由律师结合原文人工核验/);
  assert.deepEqual(Object.keys(snapshot.leadCandidates[0]!).sort(), [
    "discoveredAt", "id", "itemId", "matchedTerms", "occurrenceAt", "originalUrl", "practice", "practiceLabel", "publishedAt", "reason", "sourceName", "status", "summary", "title",
  ]);
  assert.deepEqual(snapshot.references.map(({ id }) => id), ["reference-1"]);
  assert.deepEqual(Object.keys(snapshot.references[0]!).sort(), [
    "category", "checkedAt", "eventAt", "id", "publishedAt", "reason", "referenceOnly", "sourceName", "sourceUrl", "status", "summary", "title",
  ]);
  assert.equal(snapshot.reports.daily.details["2024-02-04"]?.sections[0]?.items[0]?.originalUrl, "https://gov.cn/x");
  assert.deepEqual(Object.keys(snapshot.topics.topics[0]?.latest ?? {}).sort(), ["at", "title"]);

  const output = JSON.stringify(snapshot);
  for (const forbidden of ["body", "author", "score", "heat", "receipt", "identity", "attribution", "aihot"]) {
    assert.equal(output.includes(`\"${forbidden}\"`), false, `must not export ${forbidden}`);
  }
});

test("rejects non-public and credential-bearing URLs", () => {
  assert.equal(safePublicUrl("https://user:secret@example.com/a"), null);
  assert.equal(safePublicUrl("http://10.0.0.1/a"), null);
  assert.equal(safePublicUrl("http://[::1]/a"), null);
  assert.equal(safePublicUrl("http://[::ffff:127.0.0.1]/a"), null);
  assert.equal(safePublicUrl("http://[::7f00:1]/a"), null);
  assert.equal(safePublicUrl("file:///etc/passwd"), null);
  assert.equal(safePublicUrl("https://court.gov.cn/a"), "https://court.gov.cn/a");
});

test("content hash ignores generation time and changes with public content", async () => {
  const snapshot = await buildPublicSnapshot(asOf, readers());
  const later = { ...snapshot, generatedAt: "2026-10-06T00:00:00.000Z" };
  const changed = { ...later, site: { ...later.site, description: `${later.site.description}更新` } };
  assert.equal(publicSnapshotContentHash(snapshot), publicSnapshotContentHash(later));
  assert.notEqual(publicSnapshotContentHash(snapshot), publicSnapshotContentHash(changed));
});

test("rejects an invalid snapshot clock before reading publication data", async () => {
  await assert.rejects(buildPublicSnapshot(new Date("invalid"), readers()), /valid date/);
});
