import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
import path from "node:path";
import { parseHTML } from "linkedom";
import { guardedFetch } from "@aihot/backend/lib/http-fetch";
import { sanitizeBody } from "@aihot/backend/content/sanitize";
import { stripTags } from "@aihot/backend/lib/text";
import type { ExtractedBody } from "@aihot/backend/content/extract";

const run = promisify(execFile);
const MAX_BYTES = 6 * 1024 * 1024;
const escape = (s: string) => s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

export function pdfAttachmentUrls(html: string, url: string, selector: string): string[] {
  const { document } = parseHTML(html);
  const nodes = document.querySelectorAll(selector);
  if (nodes.length !== 1) return [];
  const found = new Set<string>();
  for (const link of nodes[0]!.querySelectorAll("a[href]")) {
    const target = new URL(link.getAttribute("href")!, url);
    if (/\.pdf$/i.test(target.pathname) || [...target.searchParams.values()].some(v => /\.pdf$/i.test(v))) found.add(target.href);
  }
  return [...found];
}

/** Existing local pypdf runtime only; no installation, network, shell, OCR or model invocation. */
export async function extractPdfAttachment(html: string, url: string, selector: string): Promise<ExtractedBody | null | undefined> {
  try {
    const urls = pdfAttachmentUrls(html, url, selector);
    if (!urls.length) return undefined;
    if (urls.length !== 1) return null;
    const target = new URL(urls[0]!);
    const origin = new URL(url);
    if (target.origin !== origin.origin || !/^https?:$/.test(target.protocol)) return null;
    const executable = process.env.PDF_PYTHON_PATH;
    if (!executable || !path.isAbsolute(executable)) return null;
    const res = await guardedFetch(target.href, { maxBytes: MAX_BYTES, timeoutMs: 25_000, redirectPolicy: "same-origin" });
    if (res.status !== 200 || !res.body.subarray(0, 5).equals(Buffer.from("%PDF-"))) return null;
    const child = run(executable, [path.join(import.meta.dirname, "pdf-extract.py")], {
      timeout: 20_000, maxBuffer: 2 * 1024 * 1024, encoding: "utf8",
      env: { PATH: path.dirname(executable), LANG: "en_US.UTF-8" },
    });
    child.child.stdin!.end(res.body);
    const { stdout } = await child;
    const parsed: unknown = JSON.parse(stdout);
    if (!parsed || typeof parsed !== "object" || !("pages" in parsed) || !Array.isArray(parsed.pages)) return null;
    const pages = parsed.pages;
    if (!pages.length || pages.length > 160 || pages.some(p => typeof p !== "string" || !p.trim() || p.includes("\ufffd"))) return null;
    const characters = pages.reduce((n: number, p: string) => n + p.length, 0);
    if (characters > 160_000) return null;
    const { document } = parseHTML(html);
    const notice = stripTags(sanitizeBody(document.querySelector(selector)!.innerHTML, url));
    const text = [notice, `【官方PDF附件；共${pages.length}页；以下逐页提取，非OCR】`, ...pages.map((p: string, i: number) => `【附件第${i + 1}/${pages.length}页】\n${p}`)].join("\n\n");
    // The long-document pipeline has the same hard bound; never label a sliced body as complete.
    if (text.length > 160_000) return null;
    return { text, html: `<pre>${escape(text)}</pre>`, images: [], via: "attachment",
      attachments: [{ url: res.url, sha256: createHash("sha256").update(res.body).digest("hex"), pages: pages.length, characters }] };
  } catch { return null; }
}
