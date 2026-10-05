import { isIP } from "node:net";
import { SITE } from "@aihot/site";
import { sha256, stableJson } from "@aihot/backend/lib/ids";
import { loadItemDetail } from "@aihot/backend/publication/detail";
import { v1HotTopics } from "@aihot/backend/publication/stories";
import { loadLeadEvidence } from "@aihot/backend/publication/lead-evidence";
import { loadPool } from "@aihot/backend/publication/pool";
import { v1Dailies, v1Daily, v1Period, v1Periods } from "@aihot/backend/publication/reports";
import { listTopicSummaries } from "@aihot/backend/publication/topics";
import { selectedSnapshot } from "@aihot/backend/publication/v1";
import type { FeedItemSummary, SiteItemDetail } from "@aihot/contracts/site";
import { matchLead } from "@aihot/industry/lead-rules";
import type {
  PublicHotItem,
  PublicItem,
  PublicLeadCandidate,
  PublicReportCollection,
  PublicReportDetail,
  PublicReportItem,
  PublicSnapshot,
  PublicTopics,
} from "./types.ts";

const DEFAULT_READERS = {
  selectedSnapshot,
  loadPool,
  loadItemDetail,
  hot: v1HotTopics,
  dailies: v1Dailies,
  daily: v1Daily,
  periods: v1Periods,
  period: v1Period,
  topics: listTopicSummaries,
  references: loadLeadEvidence,
};

export type PublicSnapshotReaders = typeof DEFAULT_READERS;

function privateIpv4(host: string): boolean {
  const p = host.split(".").map(Number);
  if (p.length !== 4 || p.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return false;
  return p[0] === 0 || p[0] === 10 || p[0] === 127 || (p[0] === 169 && p[1] === 254)
    || (p[0] === 172 && p[1]! >= 16 && p[1]! <= 31) || (p[0] === 192 && p[1] === 168)
    || (p[0] === 100 && p[1]! >= 64 && p[1]! <= 127) || p[0]! >= 224;
}

function privateHost(value: string): boolean {
  const host = value.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) return true;
  if (isIP(host) === 4) return privateIpv4(host);
  if (isIP(host) === 6) {
    if (host === "::" || host === "::1" || /^(?:fc|fd|fe[89ab])/i.test(host)) return true;
    const mapped = /^::(?:ffff:)?([\da-f]{1,4}):([\da-f]{1,4})$/i.exec(host);
    if (!mapped) return false;
    const high = Number.parseInt(mapped[1]!, 16);
    const low = Number.parseInt(mapped[2]!, 16);
    return privateIpv4(`${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`);
  }
  return false;
}

/** Only an ordinary public HTTP address may cross into the Pages snapshot. */
export function safePublicUrl(value: unknown): string | null {
  if (typeof value !== "string" || !value) return null;
  try {
    const url = new URL(value);
    if (!/^https?:$/.test(url.protocol) || url.username || url.password || !url.hostname || privateHost(url.hostname)) return null;
    return url.href;
  } catch {
    return null;
  }
}

function fromDetail(detail: SiteItemDetail): PublicItem {
  return {
    id: detail.id,
    title: detail.title,
    summary: detail.summary,
    reason: detail.selected ? detail.reason : null,
    sourceName: detail.source.name,
    originalUrl: safePublicUrl(detail.links.original),
    publishedAt: detail.publishedAt,
    discoveredAt: detail.discoveredAt,
    category: detail.category,
    tags: [...detail.tags],
    selected: detail.selected,
  };
}

async function mapLimit<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i]!);
    }
  }));
  return out;
}

async function allItems(readers: PublicSnapshotReaders, asOf: Date): Promise<PublicItem[]> {
  const cards = new Map<string, FeedItemSummary>();
  for (let page = 1; ; page++) {
    const result = await readers.loadPool({ channel: "all", category: null, tag: null, q: null, tab: "time", page, now: asOf });
    for (const item of result.items) if (!cards.has(item.id)) cards.set(item.id, item);
    if (page >= result.pageCount) break;
  }
  const details = await mapLimit([...cards.values()], 8, async (card) => readers.loadItemDetail(card.id, "zh", asOf));
  return details.flatMap((result) => result.kind === "found" ? [fromDetail(result.item)] : []);
}

async function selectedItems(readers: PublicSnapshotReaders, asOf: Date, known: Map<string, PublicItem>): Promise<PublicItem[]> {
  const items: Array<Record<string, any>> = [];
  let page: string | null = null;
  do {
    const result = await readers.selectedSnapshot({ fields: "default", limit: 1000, page }, asOf);
    items.push(...result.items);
    page = result.hasMore ? result.nextPage : null;
  } while (page);
  const unique = new Map(items.map((item) => [String(item.id), item]));
  return [...unique.values()].map((item) => {
    const fromPool = known.get(String(item.id));
    return {
      id: String(item.id),
      title: String(item.title),
      summary: typeof item.summary === "string" ? item.summary : null,
      reason: typeof item.reason === "string" ? item.reason : null,
      sourceName: String(item.source?.name ?? ""),
      originalUrl: safePublicUrl(item.links?.original),
      publishedAt: typeof item.publishedAt === "string" ? item.publishedAt : null,
      discoveredAt: String(item.discoveredAt),
      category: typeof item.category === "string" ? item.category : null,
      tags: fromPool ? [...fromPool.tags] : [],
      selected: true,
    };
  });
}

function hotItems(raw: Awaited<ReturnType<PublicSnapshotReaders["hot"]>>): PublicSnapshot["hot"] {
  const items: PublicHotItem[] = raw.items.map((item) => ({
    rank: item.rank,
    id: item.id,
    title: item.title,
    sourceName: item.source.name,
    originalUrl: safePublicUrl(item.links.original),
    sourceCount: item.sourceCount,
    signalCount: item.signalCount,
    participantCount: item.participantCount,
    sourceNames: [...item.sourceNames],
    latestAt: item.latestAt,
  }));
  return { schemaVersion: 1, count: items.length, items };
}

function reportItem(raw: Record<string, any>): PublicReportItem {
  return {
    title: String(raw.title ?? ""),
    summary: typeof raw.summary === "string" && raw.summary ? raw.summary : null,
    sourceName: String(raw.source?.name ?? ""),
    originalUrl: safePublicUrl(raw.links?.original),
    publishedAt: typeof raw.publishedAt === "string" ? raw.publishedAt : null,
  };
}

function dailyDetail(raw: Record<string, any>): PublicReportDetail {
  const report = raw.report as Record<string, any>;
  return {
    kind: "daily",
    key: String(report.date),
    generatedAt: String(report.generatedAt),
    windowStart: String(report.windowStart),
    windowEnd: String(report.windowEnd),
    headline: typeof report.lead?.title === "string" ? report.lead.title : null,
    introduction: typeof report.lead?.leadParagraph === "string" && report.lead.leadParagraph ? report.lead.leadParagraph : null,
    sections: (report.sections ?? []).map((section: Record<string, any>) => ({
      label: String(section.label ?? ""), summary: null, items: (section.items ?? []).map(reportItem),
    })),
    flashes: (report.flashes ?? []).map(reportItem),
  };
}

function periodDetail(kind: "weekly" | "monthly", raw: Record<string, any>): PublicReportDetail {
  const report = raw.report as Record<string, any>;
  return {
    kind,
    key: String(report[kind === "weekly" ? "week" : "month"]),
    generatedAt: String(report.generatedAt),
    windowStart: String(report.windowStart),
    windowEnd: String(report.windowEnd),
    headline: typeof report.headline === "string" ? report.headline : null,
    introduction: typeof report.overview === "string" && report.overview ? report.overview : null,
    sections: (report.sections ?? []).map((section: Record<string, any>) => ({
      label: String(section.label ?? ""),
      summary: typeof section.summary === "string" && section.summary ? section.summary : null,
      items: (section.items ?? []).map(reportItem),
    })),
    flashes: [],
  };
}

async function reports(readers: PublicSnapshotReaders): Promise<PublicSnapshot["reports"]> {
  const dailyIndex = await readers.dailies(180);
  const weeklyIndex = await readers.periods("weekly", 60);
  const monthlyIndex = await readers.periods("monthly", 60);
  const build = async (
    kind: "daily" | "weekly" | "monthly",
    entries: Array<Record<string, any>>,
  ): Promise<PublicReportCollection> => {
    const index = entries.map((entry) => ({
      key: String(entry.date ?? entry.week ?? entry.month),
      generatedAt: String(entry.generatedAt),
      headline: typeof (entry.leadTitle ?? entry.headline) === "string" ? String(entry.leadTitle ?? entry.headline) : null,
    }));
    const loaded = await mapLimit(index, 6, async (entry) => kind === "daily"
      ? readers.daily(entry.key)
      : readers.period(kind, entry.key));
    const details: Record<string, PublicReportDetail> = {};
    for (let i = 0; i < index.length; i++) {
      const raw = loaded[i];
      if (raw) details[index[i]!.key] = kind === "daily" ? dailyDetail(raw) : periodDetail(kind, raw);
    }
    return { index, details };
  };
  const [daily, weekly, monthly] = await Promise.all([
    build("daily", dailyIndex.items), build("weekly", weeklyIndex.items), build("monthly", monthlyIndex.items),
  ]);
  return { daily, weekly, monthly };
}

function topics(raw: Awaited<ReturnType<PublicSnapshotReaders["topics"]>>): PublicTopics {
  return {
    groups: raw.groups.map(({ key, name, blurb }) => ({ key, name, blurb })),
    topics: raw.topics.map(({ slug, name, group, definition, total, recent, indexable, latest }) => ({
      slug,
      name,
      group,
      definition,
      total,
      recent,
      indexable,
      latest: latest ? { title: latest.title, at: latest.at } : null,
    })),
  };
}

function candidates(items: PublicItem[]): PublicLeadCandidate[] {
  return items.flatMap((item) => {
    const card: FeedItemSummary = {
      id: item.id, title: item.title, summary: item.summary, reason: item.reason, source: { name: item.sourceName },
      publishedAt: item.publishedAt, timelineAt: item.discoveredAt, category: item.category as FeedItemSummary["category"],
      tags: item.tags, score: null, selected: item.selected, channel: "news", x: null,
    };
    return matchLead(card).map((match) => ({
      id: `${item.id}:${match.practice}`,
      itemId: item.id,
      title: item.title,
      summary: item.summary,
      practice: match.practice,
      practiceLabel: match.practiceLabel,
      reason: match.reason,
      matchedTerms: [...match.matchedTerms],
      sourceName: item.sourceName,
      originalUrl: item.originalUrl,
      publishedAt: item.publishedAt,
      discoveredAt: item.discoveredAt,
      occurrenceAt: null,
      status: "pending_review" as const,
    }));
  });
}

export async function buildPublicSnapshot(asOf: Date, readers: PublicSnapshotReaders): Promise<PublicSnapshot> {
  if (!Number.isFinite(asOf.getTime())) throw new TypeError("asOf must be a valid date");
  const [all, hot, reportData, topicData, referenceData] = await Promise.all([
    allItems(readers, asOf), readers.hot(), reports(readers), readers.topics(), readers.references({ q: "", practice: "all" }),
  ]);
  const selected = await selectedItems(readers, asOf, new Map(all.map((item) => [item.id, item])));
  const references = referenceData.items.flatMap((item) => {
    const sourceUrl = safePublicUrl(item.sourceUrl);
    if (!sourceUrl) return [];
    return [{
      id: item.id,
      title: item.title,
      summary: item.summary,
      sourceName: item.sourceName,
      sourceUrl,
      publishedAt: item.publishedAt,
      eventAt: item.eventAt,
      category: item.category,
      reason: item.reason,
      checkedAt: item.checkedAt,
      status: item.status,
      referenceOnly: item.referenceOnly,
    }];
  });
  return {
    schemaVersion: 1,
    site: { name: SITE.name, description: SITE.description },
    generatedAt: asOf.toISOString(),
    selected,
    all,
    hot: hotItems(hot),
    reports: reportData,
    topics: topics(topicData),
    leadCandidates: candidates(all),
    references,
  };
}

export function exportPublicSnapshot(asOf = new Date()): Promise<PublicSnapshot> {
  return buildPublicSnapshot(asOf, DEFAULT_READERS);
}

/** Stable content identity for changed-only publication; the attempt time itself is deliberately excluded. */
export function publicSnapshotContentHash(snapshot: PublicSnapshot): string {
  const { generatedAt: _generatedAt, ...content } = snapshot;
  return sha256(stableJson(content));
}
