import { createHash } from "node:crypto";
import { z } from "zod";
import { chatJson, ModelOutputError } from "../providers/llm.ts";
import { rejectReceivedResponse } from "../providers/receipts.ts";
import { shutdownSignal } from "../jobs/queue.ts";
import type { AnalyzeInputArticle } from "./input.ts";
import { modelFor } from "./models.ts";
import { promptText, promptVersion } from "./prompts.ts";
import { MAX_BODY_CHARS } from "./writing.ts";

const SEGMENT_CHARS = 20_000;
const BLOCK_CHARS = 700;
const MAX_SEGMENTS = 8;
const MAX_EVIDENCE_BLOCKS = 10;
const PROMPT = promptText("long-document-evidence");
export const LONG_DOCUMENT_EVIDENCE_VERSION = promptVersion("long-document-evidence");

const SelectionSchema = z.object({
  blockIds: z.array(z.string()).min(1).max(MAX_EVIDENCE_BLOCKS),
});

export interface DocumentEvidenceBlock {
  id: string;
  start: number;
  end: number;
}

export interface DocumentCoverageSegment {
  index: number;
  start: number;
  end: number;
  sha256: string;
  receiptId: number;
  blocks: DocumentEvidenceBlock[];
}

export interface DocumentCoverage {
  complete: true;
  version: string;
  bodyChars: number;
  bodySha256: string;
  offsetUnit: "utf16";
  segments: DocumentCoverageSegment[];
  receiptIds: number[];
  /** True only when every segment answer came from an existing received receipt. */
  reused: boolean;
}

interface SourceBlock extends DocumentEvidenceBlock {
  text: string;
}

interface SourceSegment {
  index: number;
  start: number;
  end: number;
  sha256: string;
  blocks: SourceBlock[];
}

const hash = (text: string) => createHash("sha256").update(text).digest("hex");

/** Moves a UTF-16 boundary left when it would split one surrogate pair. */
function safeBoundary(text: string, end: number, start: number): number {
  if (end <= start || end >= text.length) return end;
  const before = text.charCodeAt(end - 1);
  const after = text.charCodeAt(end);
  return before >= 0xd800 && before <= 0xdbff && after >= 0xdc00 && after <= 0xdfff ? end - 1 : end;
}

function segmentRanges(body: string): Array<{ start: number; end: number }> {
  // The limit is based on the nominal 20k budget, before paragraph-boundary adjustments, so a long
  // document cannot silently turn into an unbounded number of paid calls.
  if (Math.ceil(body.length / SEGMENT_CHARS) > MAX_SEGMENTS) {
    throw new Error(`long document needs more than ${MAX_SEGMENTS} segments at ${SEGMENT_CHARS} UTF-16 characters each`);
  }

  const ranges: Array<{ start: number; end: number }> = [];
  let start = 0;
  while (start < body.length) {
    const target = Math.min(start + SEGMENT_CHARS, body.length);
    let end = target;
    if (target < body.length) {
      const floor = start + Math.floor(SEGMENT_CHARS * 0.75);
      // Search starts far enough left that including the delimiter can never cross the target.
      const paragraph = body.lastIndexOf("\n\n", target - 2);
      const line = body.lastIndexOf("\n", target - 1);
      const boundary = paragraph >= floor ? paragraph + 2 : line >= floor ? line + 1 : target;
      end = safeBoundary(body, boundary, start);
    }
    if (end <= start) throw new Error("long document segmentation made no progress");
    ranges.push({ start, end });
    start = end;
  }
  if (ranges.length > MAX_SEGMENTS) throw new Error(`long document needs more than ${MAX_SEGMENTS} segments`);
  return ranges;
}

function sourceSegments(body: string): SourceSegment[] {
  let blockNumber = 0;
  return segmentRanges(body).map((range, segmentIndex) => {
    const blocks: SourceBlock[] = [];
    let start = range.start;
    while (start < range.end) {
      let end = safeBoundary(body, Math.min(start + BLOCK_CHARS, range.end), start);
      if (end <= start) end = Math.min(start + BLOCK_CHARS, range.end);
      blockNumber += 1;
      blocks.push({ id: `B${String(blockNumber).padStart(3, "0")}`, start, end, text: body.slice(start, end) });
      start = end;
    }
    return {
      index: segmentIndex + 1,
      start: range.start,
      end: range.end,
      sha256: hash(body.slice(range.start, range.end)),
      blocks,
    };
  });
}

function derivedAttemptTag(attemptTag: string | undefined, index: number): string | undefined {
  return attemptTag ? `${attemptTag}:long-document-chunk-${index}` : undefined;
}

function evidencePack(body: string, segments: DocumentCoverageSegment[]): string {
  const lines = [
    "以下是对全文每个分段都扫描后选出的确定性原文证据摘录，不是全文。",
    "未摘录的内容不得推断；每个证据块的文字与原文逐字一致，区间使用 UTF-16 起止偏移。",
    "",
  ];
  for (const segment of segments) {
    for (const block of segment.blocks) {
      lines.push(`【证据块 ${block.id}；全文 UTF-16 区间 [${block.start}, ${block.end})；来自分段 ${segment.index}/${segments.length}；分段范围 [${segment.start}, ${segment.end})】`);
      lines.push(body.slice(block.start, block.end), "");
    }
  }
  const text = lines.join("\n");
  if (text.length > MAX_BODY_CHARS) {
    throw new Error(`long-document evidence pack exceeds ${MAX_BODY_CHARS} UTF-16 characters (${text.length}); refusing to slice verified evidence`);
  }
  return text;
}

export async function prepareDocumentEvidence(
  a: AnalyzeInputArticle,
  opts: { attemptTag?: string } = {},
): Promise<{ article: AnalyzeInputArticle; coverage: DocumentCoverage | null }> {
  const body = a.bodyText;
  if (!body || body.length <= MAX_BODY_CHARS || a.xPost) return { article: a, coverage: null };

  const bodySha256 = hash(body);
  const source = sourceSegments(body);
  const model = await modelFor("structure");
  const completed: DocumentCoverageSegment[] = [];
  const reused: boolean[] = [];

  for (const segment of source) {
    shutdownSignal.signal.throwIfAborted();
    const result = await chatJson({
      model,
      purpose: "long_document_chunk",
      subject: `article:${a.id}@${a.revision}#chunk:${segment.index}/${source.length}`,
      promptVersion: LONG_DOCUMENT_EVIDENCE_VERSION,
      system: PROMPT,
      user: JSON.stringify({
        articleId: a.id,
        revision: a.revision,
        chunk: segment.index,
        totalChunks: source.length,
        offsetUnit: "utf16",
        documentSha256: bodySha256,
        segmentSha256: segment.sha256,
        start: segment.start,
        end: segment.end,
        blocks: segment.blocks,
      }),
      schema: SelectionSchema,
      temperature: 0,
      maxTokens: 256,
      attemptTag: derivedAttemptTag(opts.attemptTag, segment.index),
    });

    const byId = new Map(segment.blocks.map((block) => [block.id, block]));
    const selected: SourceBlock[] = [];
    const seen = new Set<string>();
    let invalid: string | null = null;
    for (const id of result.data.blockIds) {
      const block = byId.get(id);
      if (!block) invalid = `unknown block ID ${id}`;
      else if (seen.has(id)) invalid = `duplicate block ID ${id}`;
      else if (!/\S/u.test(block.text)) invalid = `pure-whitespace block ${id}`;
      if (invalid) break;
      seen.add(id);
      selected.push(block!);
    }
    if (invalid || selected.length === 0) {
      const reason = `unusable long-document evidence selection: ${invalid ?? "no valid block"}`;
      await rejectReceivedResponse(result.receiptId, reason);
      throw new ModelOutputError(`Model ${model} returned ${reason} for article ${a.id} segment ${segment.index}`, result.receiptId);
    }

    selected.sort((left, right) => left.start - right.start);
    completed.push({
      index: segment.index,
      start: segment.start,
      end: segment.end,
      sha256: segment.sha256,
      receiptId: result.receiptId,
      blocks: selected.map(({ id, start, end }) => ({ id, start, end })),
    });
    reused.push(result.reused);
  }

  const text = evidencePack(body, completed);
  const coverage: DocumentCoverage = {
    complete: true,
    version: LONG_DOCUMENT_EVIDENCE_VERSION,
    bodyChars: body.length,
    bodySha256,
    offsetUnit: "utf16",
    segments: completed,
    receiptIds: completed.map((segment) => segment.receiptId),
    reused: reused.every(Boolean),
  };
  return {
    article: { ...a, documentEvidence: { text, characters: body.length, segments: source.length } },
    coverage,
  };
}
