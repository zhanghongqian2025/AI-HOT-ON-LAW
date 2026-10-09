import type { FeedItemSummary, SiteItemDetail } from "@aihot/contracts/site";

export const PRACTICES = ["securities", "insolvency", "labor", "intellectual-property", "compliance"] as const;
export type Practice = (typeof PRACTICES)[number];
export type PracticeFilter = Practice | "all";

export const PRACTICE_LABELS: Record<Practice, string> = {
  securities: "证券",
  insolvency: "破产",
  labor: "劳动",
  "intellectual-property": "知识产权",
  compliance: "监管合规",
};

const PRACTICE_TERMS: Record<Practice, readonly string[]> = {
  securities: ["证券虚假陈述", "信息披露违法", "信披违法", "内幕交易", "操纵市场", "投资者索赔", "股民索赔", "证券索赔", "退市", "上市公司爆雷"],
  insolvency: ["破产重整", "预重整", "破产清算", "破产申请", "债权申报", "资不抵债", "清算组", "管理人招募"],
  labor: ["拖欠工资", "欠薪", "大规模裁员", "集体裁员", "劳动争议", "工伤", "竞业限制", "违法解除", "社保补缴", "劳动仲裁"],
  "intellectual-property": ["专利侵权", "商标侵权", "著作权侵权", "侵害著作权", "商业秘密", "不正当竞争", "知识产权诉讼", "知识产权纠纷", "专利无效"],
  compliance: ["行政处罚", "监管处罚", "合规整改", "反垄断调查", "数据合规", "个人信息保护", "数据泄露", "市场监管局处罚", "金融监管处罚", "证监会立案"],
};

export interface LeadMatch {
  practice: Practice;
  practiceLabel: string;
  matchedTerms: string[];
  reason: string;
}

export interface LeadCandidate extends LeadMatch {
  id: string;
  title: string;
  summary: string | null;
  sourceName: string;
  sourceUrl: string | null;
  publishedAt: string | null;
  discoveredAt: string | null;
  occurrenceAt: null;
  status: "pending_review";
}

export function isPracticeFilter(value: string | null): value is PracticeFilter {
  return value === "all" || PRACTICES.includes(value as Practice);
}

function searchableText(item: FeedItemSummary): string {
  return [item.title, item.summary, item.reason, ...item.tags].filter(Boolean).join("\n").toLocaleLowerCase("zh-CN");
}

const STRONG_PROMOTIONAL_TITLE = /(?:培训|课程|招生|直播预告|活动邀请)/;
const REGISTRATION_TITLE = /报名/;
const EVENT_PROMOTIONAL_TITLE = /(?:论坛|峰会|研讨会|沙龙|会议宣传)/;
const FORMAL_PROCEEDING = /(?:行政处罚|监管处罚|立案|判决|裁决|开庭|破产|清算|重整|侵权|违法|调查|听证)/;
const OFFICIAL_INSOLVENCY_SOURCE = /全国企业破产重整案件信息网/;
const INVESTOR_RECRUITMENT_NOTICE = /(?=.*公告)(?=.*(?:投资人.{0,12}招募|招募.{0,12}投资人))/;

function isOfficialInvestorRecruitmentNotice(item: FeedItemSummary): boolean {
  return OFFICIAL_INSOLVENCY_SOURCE.test(item.source.name) && INVESTOR_RECRUITMENT_NOTICE.test(item.title);
}

function isPromotionalNoise(item: FeedItemSummary): boolean {
  return STRONG_PROMOTIONAL_TITLE.test(item.title)
    || (REGISTRATION_TITLE.test(item.title) && !isOfficialInvestorRecruitmentNotice(item))
    || (EVENT_PROMOTIONAL_TITLE.test(item.title) && !FORMAL_PROCEEDING.test(item.title));
}

/** Pure keyword screen: it proposes a review candidate and never claims a client, matter, or model finding. */
export function matchLead(item: FeedItemSummary, filter: PracticeFilter = "all"): LeadMatch[] {
  if (isPromotionalNoise(item)) return [];
  const text = searchableText(item);
  const practices = filter === "all" ? PRACTICES : [filter];
  return practices.flatMap((practice) => {
    const matchedTerms = PRACTICE_TERMS[practice].filter((term) => text.includes(term.toLocaleLowerCase("zh-CN")));
    if (matchedTerms.length === 0) return [];
    const shown = matchedTerms.slice(0, 3);
    return [{
      practice,
      practiceLabel: PRACTICE_LABELS[practice],
      matchedTerms: shown,
      reason: `公开内容中出现“${shown.join("、")}”，可能涉及${PRACTICE_LABELS[practice]}法律服务需求，需由律师结合原文人工核验。`,
    }];
  });
}

/** Only an ordinary public http(s) address is exposed as the original source link. */
export function safeSourceUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if ((url.protocol !== "http:" && url.protocol !== "https:") || !url.hostname || url.username || url.password) return null;
    return url.href;
  } catch {
    return null;
  }
}

export function toLeadCandidate(item: FeedItemSummary, match: LeadMatch, detail: SiteItemDetail | null): LeadCandidate {
  return {
    ...match,
    id: item.id,
    title: item.title,
    summary: item.summary,
    sourceName: item.source.name,
    sourceUrl: safeSourceUrl(detail?.links.original),
    publishedAt: item.publishedAt,
    discoveredAt: detail?.discoveredAt ?? null,
    occurrenceAt: null,
    status: "pending_review",
  };
}
