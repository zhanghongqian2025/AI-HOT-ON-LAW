import type { CategoryKey } from "@aihot/contracts/taxonomy";
import type { LeadEvidenceItem, LeadEvidencePractice } from "@aihot/backend/publication/lead-evidence";

export interface PublicItem {
  id: string;
  title: string;
  summary: string | null;
  reason: string | null;
  sourceName: string;
  originalUrl: string | null;
  publishedAt: string | null;
  discoveredAt: string;
  category: CategoryKey | string | null;
  tags: string[];
  selected: boolean;
}

export interface PublicHotItem {
  rank: number;
  id: string;
  title: string;
  sourceName: string;
  originalUrl: string | null;
  sourceCount: number;
  signalCount: number;
  participantCount: number;
  sourceNames: string[];
  latestAt: string;
}

export interface PublicReportIndexItem {
  key: string;
  generatedAt: string;
  headline: string | null;
}

export interface PublicReportItem {
  title: string;
  summary: string | null;
  sourceName: string;
  originalUrl: string | null;
  publishedAt: string | null;
}

export interface PublicReportDetail {
  kind: "daily" | "weekly" | "monthly";
  key: string;
  generatedAt: string;
  windowStart: string;
  windowEnd: string;
  headline: string | null;
  introduction: string | null;
  sections: Array<{ label: string; summary: string | null; items: PublicReportItem[] }>;
  flashes: PublicReportItem[];
}

export interface PublicReportCollection {
  index: PublicReportIndexItem[];
  details: Record<string, PublicReportDetail>;
}

export interface PublicTopic {
  slug: string;
  name: string;
  group: string;
  definition: string;
  total: number;
  recent: number;
  indexable: boolean;
  latest: { title: string; at: string } | null;
}

export interface PublicTopics {
  groups: Array<{ key: string; name: string; blurb: string }>;
  topics: PublicTopic[];
}

export interface PublicLeadCandidate {
  id: string;
  itemId: string;
  title: string;
  summary: string | null;
  practice: LeadEvidencePractice;
  practiceLabel: string;
  reason: string;
  matchedTerms: string[];
  sourceName: string;
  originalUrl: string | null;
  publishedAt: string | null;
  discoveredAt: string;
  occurrenceAt: null;
  status: "pending_review";
}

export interface PublicSnapshot {
  schemaVersion: 1;
  site: { name: string; description: string };
  /** Static snapshot generation time; never an event or publication date. */
  generatedAt: string;
  selected: PublicItem[];
  all: PublicItem[];
  hot: { schemaVersion: 1; count: number; items: PublicHotItem[] };
  reports: {
    daily: PublicReportCollection;
    weekly: PublicReportCollection;
    monthly: PublicReportCollection;
  };
  topics: PublicTopics;
  leadCandidates: PublicLeadCandidate[];
  references: LeadEvidenceItem[];
}
