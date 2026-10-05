import { Link, useLoaderData } from "react-router";
import type { FeedItemSummary, PoolResponse, SiteItemDetail } from "@aihot/contracts/site";
import { apiGet, edgeTtl } from "@aihot/web/lib/api.server";
import { pageMeta } from "@aihot/web/lib/seo";
import { fullDateTime } from "@aihot/web/lib/format";
import { EmptyState } from "@aihot/web/components/ui/Page";
import { Select, buttonClass } from "@aihot/web/components/ui/Controls";
import { PhoneBar } from "@aihot/web/components/shell/PhoneBar";
import type { Screen } from "@aihot/web/components/shell/screens";
import { isPracticeFilter, matchLead, PRACTICE_LABELS, PRACTICES, toLeadCandidate, type LeadCandidate, type Practice, type PracticeFilter } from "./rules.ts";

export const handle: Screen = { home: "featured", name: "案源线索" };

const PAGE_SIZE_NOTE = "当前页面只对站内公开检索的第一页结果开展规则筛选。";

interface ReferenceLead {
  id: string;
  title: string;
  summary: string;
  sourceName: string;
  sourceUrl: string | null;
  publishedAt: string;
  eventAt: string | null;
  practice: Practice;
  practiceLabel: string;
  reason: string;
  checkedAt: string;
  status: "pending_review";
  referenceOnly: true;
}

interface LeadEvidenceResponse {
  filters: { q: string; practice: PracticeFilter };
  items: Array<Omit<ReferenceLead, "practice" | "practiceLabel"> & { category: Practice }>;
}

function evidencePath(query: string, practice: PracticeFilter): string {
  const params = new URLSearchParams({ q: query, practice });
  return `/api/site/lead-evidence?${params}`;
}

function queryPath(query: string): string {
  const params = new URLSearchParams({ q: query, tab: "relevance" });
  return `/api/site/pool?${params}`;
}

function plainDate(value: string): string {
  const [year, month, day] = value.slice(0, 10).split("-");
  return year && month && day ? `${year}年${Number(month)}月${Number(day)}日` : value;
}

export async function loader({ request }: { request: Request }) {
  const url = new URL(request.url);
  const query = url.searchParams.get("q")?.trim().slice(0, 120) ?? "";
  const requestedPractice = url.searchParams.get("practice");
  const practice: PracticeFilter = isPracticeFilter(requestedPractice) ? requestedPractice : "all";
  if (!query) return { query, practice, candidates: [] as LeadCandidate[], references: [] as ReferenceLead[], searched: false, resultCount: 0, missingDetails: 0, poolUnavailable: false, evidenceUnavailable: false };

  const [poolResult, evidenceResult] = await Promise.allSettled([
    apiGet<PoolResponse>(queryPath(query), { signal: request.signal }),
    apiGet<LeadEvidenceResponse>(evidencePath(query, practice), { signal: request.signal }),
  ]);
  if (request.signal.aborted) throw request.signal.reason;
  const pool = poolResult.status === "fulfilled" ? poolResult.value : null;
  const references = evidenceResult.status === "fulfilled" ? evidenceResult.value.items.map((item) => ({ ...item, practice: item.category, practiceLabel: PRACTICE_LABELS[item.category] })) : [];
  const matched = (pool?.items ?? []).flatMap((item) => matchLead(item, practice).map((match) => ({ item, match })));
  const details = await Promise.all(matched.map(({ item }) => apiGet<SiteItemDetail>(`/api/site/items/${encodeURIComponent(item.id)}`, { signal: request.signal }).catch(() => null)));
  const candidates = matched.map(({ item, match }, index) => toLeadCandidate(item, match, details[index] ?? null));
  return {
    query,
    practice,
    candidates,
    references,
    searched: true,
    resultCount: pool?.total ?? null,
    missingDetails: details.filter((detail) => detail === null).length,
    poolUnavailable: pool === null,
    evidenceUnavailable: evidenceResult.status === "rejected",
  };
}

export function meta({ loaderData }: { loaderData?: Awaited<ReturnType<typeof loader>> }) {
  const suffix = loaderData?.query ? `：${loaderData.query}` : "";
  return pageMeta({
    title: `法律案源线索${suffix}`,
    rawTitle: true,
    description: "从站内已收录的公开内容中检索可能涉及法律服务需求的待核验线索。",
    path: "/leads",
    noindex: !!loaderData?.query,
  });
}

export function headers() {
  return edgeTtl(60);
}

function CandidateCard({ candidate }: { candidate: LeadCandidate }) {
  return (
    <article className="card p-5 lg:p-6">
      <div className="flex flex-wrap items-center gap-2 text-[12px]">
        <span className="rounded-full bg-accent-soft px-2.5 py-1 font-semibold text-accent">{candidate.practiceLabel}</span>
        <span className="rounded-full border border-line px-2.5 py-1 font-semibold text-ink-3">待人工核验</span>
        <span className="text-ink-4">{candidate.sourceName}</span>
      </div>
      <h2 className="mt-3 text-[18px] font-bold leading-[1.5] text-ink">
        <Link to={`/items/${candidate.id}`} className="hover:text-accent">{candidate.title}</Link>
      </h2>
      {candidate.summary && <p className="mt-2 text-[14px] leading-[1.75] text-ink-2">{candidate.summary}</p>}
      <div className="mt-4 rounded-tile bg-bg-sunk px-4 py-3">
        <div className="text-[12px] font-semibold text-ink-3">候选理由（关键词规则）</div>
        <p className="mt-1 text-[13px] leading-[1.7] text-ink-2">{candidate.reason}</p>
      </div>
      <dl className="mt-4 grid gap-x-6 gap-y-2 text-[12.5px] text-ink-3 sm:grid-cols-2">
        <div><dt className="inline text-ink-4">事件发生时间：</dt><dd className="inline">尚未结构化，待人工核验</dd></div>
        <div><dt className="inline text-ink-4">原文发布时间：</dt><dd className="inline">{candidate.publishedAt ? fullDateTime(candidate.publishedAt) : "未知"}</dd></div>
        <div><dt className="inline text-ink-4">本站发现时间：</dt><dd className="inline">{candidate.discoveredAt ? fullDateTime(candidate.discoveredAt) : "未取得"}</dd></div>
        <div><dt className="inline text-ink-4">命中词：</dt><dd className="inline">{candidate.matchedTerms.join("、")}</dd></div>
      </dl>
      <div className="mt-4 flex flex-wrap gap-4 text-[13px] font-medium">
        <Link to={`/items/${candidate.id}`} className="text-accent hover:underline">查看站内详情</Link>
        {candidate.sourceUrl ? (
          <a href={candidate.sourceUrl} target="_blank" rel="noreferrer" className="text-accent hover:underline">查看原始来源</a>
        ) : (
          <span className="font-normal text-ink-4">原始来源链接暂不可用</span>
        )}
      </div>
    </article>
  );
}

function ReferenceCard({ reference }: { reference: ReferenceLead }) {
  return (
    <article className="card border-accent/20 p-5 lg:p-6">
      <div className="flex flex-wrap items-center gap-2 text-[12px]">
        <span className="rounded-full bg-accent-soft px-2.5 py-1 font-semibold text-accent">{reference.practiceLabel}</span>
        <span className="rounded-full border border-line px-2.5 py-1 font-semibold text-ink-3">待人工核验</span>
        <span className="rounded-full border border-line px-2.5 py-1 font-semibold text-ink-3">人工整理公开事件 · 非实时</span>
      </div>
      <h2 className="mt-3 text-[18px] font-bold leading-[1.5] text-ink">{reference.title}</h2>
      <p className="mt-2 text-[14px] leading-[1.75] text-ink-2">{reference.summary}</p>
      <div className="mt-4 rounded-tile bg-bg-sunk px-4 py-3">
        <div className="text-[12px] font-semibold text-ink-3">业务关联说明（人工整理）</div>
        <p className="mt-1 text-[13px] leading-[1.7] text-ink-2">{reference.reason}</p>
      </div>
      <dl className="mt-4 grid gap-x-6 gap-y-2 text-[12.5px] text-ink-3 sm:grid-cols-2">
        <div><dt className="inline text-ink-4">事件发生时间：</dt><dd className="inline">{reference.eventAt ? plainDate(reference.eventAt) : "尚未结构化，待人工核验"}</dd></div>
        <div><dt className="inline text-ink-4">原文发布时间：</dt><dd className="inline">{plainDate(reference.publishedAt)}</dd></div>
        <div><dt className="inline text-ink-4">人工核验日期：</dt><dd className="inline">{plainDate(reference.checkedAt)}</dd></div>
        <div><dt className="inline text-ink-4">来源：</dt><dd className="inline">{reference.sourceName}</dd></div>
      </dl>
      <div className="mt-4 text-[13px] font-medium">
        {reference.sourceUrl ? <a href={reference.sourceUrl} target="_blank" rel="noreferrer" className="text-accent hover:underline">查看原始来源</a> : <span className="font-normal text-ink-4">原始来源链接无效，已隐藏</span>}
      </div>
    </article>
  );
}

export default function LeadsPage() {
  const data = useLoaderData<typeof loader>();
  return (
    <div className="mx-auto max-w-[var(--page-max-reading)] pb-12">
      <PhoneBar back={{ to: "/", label: "精选" }} title="法律案源线索" />
      <header className="pt-3 lg:pt-0">
        <p className="text-[12px] font-semibold tracking-wide text-accent">律师工作台 · V1</p>
        <h1 data-page-title="" className="mt-2 text-[28px] font-black leading-tight tracking-[-0.02em] text-ink lg:text-[34px]">法律案源线索</h1>
        <p className="mt-3 max-w-3xl text-[14px] leading-[1.8] text-ink-3">
          检索站内已收录的公开内容，再按明确关键词标记可能的法律服务需求。结果是待核验候选，不是已确认客户或已立案案件。
        </p>
      </header>

      <form method="get" action="/leads" className="card mt-6 grid gap-3 p-4 sm:grid-cols-[minmax(0,1fr)_180px_auto] sm:items-end lg:p-5">
        <label className="min-w-0 text-[12px] font-semibold text-ink-3">
          搜索关键词
          <input name="q" defaultValue={data.query} maxLength={120} placeholder="例：裁员、信息披露、数据泄露" className="mt-1.5 h-11 w-full rounded-full border border-line-strong bg-surface px-4 text-[16px] text-ink outline-none focus:border-accent lg:h-10 lg:text-[14px]" />
        </label>
        <label className="text-[12px] font-semibold text-ink-3">
          业务类别
          <Select name="practice" defaultValue={data.practice} className="mt-1.5 w-full">
            <option value="all">全部类别</option>
            {PRACTICES.map((practice) => <option key={practice} value={practice}>{PRACTICE_LABELS[practice]}</option>)}
          </Select>
        </label>
        <button type="submit" className={buttonClass("primary", "md")}>搜索线索</button>
      </form>

      <p className="mt-3 text-[12px] leading-relaxed text-ink-4">{PAGE_SIZE_NOTE} 它不采集非公开个人资料，不自动联系任何主体。</p>

      {!data.searched ? (
        <div className="mt-6 card"><EmptyState title="输入关键词开始搜索">候选只在公开内容命中法律业务关键词时生成。</EmptyState></div>
      ) : data.candidates.length === 0 && data.references.length === 0 ? (
        <div className="mt-6 card"><EmptyState title="未发现符合规则的候选线索">{data.poolUnavailable && data.evidenceUnavailable ? "站内公开搜索与人工整参考接口暂时都不可用。" : data.poolUnavailable ? "站内公开搜索暂时不可用，人工整理参考中没有命中当前查询。" : data.evidenceUnavailable ? `站内检索到 ${data.resultCount} 条相关公开内容，当前页没有命中规则；人工整理参考接口暂时不可用。` : `检索到 ${data.resultCount} 条相关公开内容，但当前页与人工整理参考中没有命中所选业务类别的候选。`}</EmptyState></div>
      ) : (
        <section aria-labelledby="lead-results" className="mt-7">
          <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
            <h2 id="lead-results" className="text-[16px] font-bold text-ink">待核验候选 · {data.candidates.length + data.references.length}</h2>
            <span className="text-[12px] text-ink-4">{data.poolUnavailable ? "站内公开搜索暂时不可用" : `站内检索命中 ${data.resultCount} 条`}</span>
          </div>
          {data.poolUnavailable && <p role="status" className="mb-3 rounded-tile border border-line bg-bg-sunk px-3 py-2 text-[12px] text-ink-3">站内公开搜索暂时不可用。以下若有结果，仅来自人工整理的历史公开事件。</p>}
          {data.evidenceUnavailable && <p role="status" className="mb-3 rounded-tile border border-line bg-bg-sunk px-3 py-2 text-[12px] text-ink-3">人工整理参考接口暂时不可用；以下若有结果，仅来自站内公开搜索的关键词规则。</p>}
          {data.missingDetails > 0 && <p role="status" className="mb-3 rounded-tile border border-line bg-bg-sunk px-3 py-2 text-[12px] text-ink-3">{data.missingDetails} 条候选暂未取得详情，因此不展示原始来源链接或发现时间。</p>}
          <div className="space-y-4">
            {data.references.map((reference) => <ReferenceCard key={`reference:${reference.id}`} reference={reference} />)}
            {data.candidates.map((candidate) => <CandidateCard key={`${candidate.id}:${candidate.practice}`} candidate={candidate} />)}
          </div>
        </section>
      )}
    </div>
  );
}
