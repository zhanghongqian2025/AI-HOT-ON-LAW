import { readFileSync } from "node:fs";

const PRACTICES = ["securities", "insolvency", "labor", "intellectual-property", "compliance"] as const;
export type LeadEvidencePractice = (typeof PRACTICES)[number];

export interface LeadEvidenceItem {
  id: string;
  title: string;
  summary: string;
  sourceName: string;
  sourceUrl: string;
  publishedAt: string;
  eventAt: string | null;
  category: LeadEvidencePractice;
  reason: string;
  checkedAt: string;
  status: "pending_review";
  referenceOnly: true;
}

export interface LeadEvidenceResponse {
  filters: { q: string; practice: LeadEvidencePractice | "all" };
  items: LeadEvidenceItem[];
}

const file = JSON.parse(readFileSync(new URL("../../../../industry/lead-evidence.json", import.meta.url), "utf8")) as unknown;

function publicHttpUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return (url.protocol === "http:" || url.protocol === "https:") && !!url.hostname && !url.username && !url.password;
  } catch {
    return false;
  }
}

function validDate(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function isLeadEvidenceItem(value: unknown): value is LeadEvidenceItem {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  return typeof item.id === "string"
    && typeof item.title === "string"
    && typeof item.summary === "string"
    && typeof item.sourceName === "string"
    && publicHttpUrl(item.sourceUrl)
    && validDate(item.publishedAt)
    && (item.eventAt === null || validDate(item.eventAt))
    && PRACTICES.includes(item.category as LeadEvidencePractice)
    && typeof item.reason === "string"
    && validDate(item.checkedAt)
    && item.status === "pending_review"
    && item.referenceOnly === true;
}

const ITEMS: readonly LeadEvidenceItem[] = Array.isArray(file) ? file.filter(isLeadEvidenceItem) : [];

/** Reads only the curated public reference set. It does not infer a client, matter, or current demand. */
export function loadLeadEvidence(input: { q: string; practice: LeadEvidencePractice | "all" }): LeadEvidenceResponse {
  const needle = input.q.trim().slice(0, 120).toLocaleLowerCase("zh-CN");
  const items = ITEMS.filter((item) => {
    if (input.practice !== "all" && item.category !== input.practice) return false;
    if (!needle) return true;
    return [item.title, item.summary, item.reason, item.sourceName].join("\n").toLocaleLowerCase("zh-CN").includes(needle);
  });
  return { filters: { q: needle, practice: input.practice }, items: [...items] };
}

export function isLeadEvidencePractice(value: string): value is LeadEvidencePractice {
  return PRACTICES.includes(value as LeadEvidencePractice);
}
