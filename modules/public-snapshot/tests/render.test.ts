import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type { PublicSnapshot } from "../types.ts";
import { writePublicSite } from "../render.ts";

const hostile = `</script><img src=x onerror="globalThis.pwned=true">`;

const snapshot = {
  schemaVersion: 1,
  site: { name: "AI HOT-ON-LAW", description: hostile },
  generatedAt: "2026-10-05T01:02:03.000Z",
  selected: [{
    id: "selected-1", title: hostile, summary: "摘要", reason: "待人工核验", sourceName: "公开来源",
    originalUrl: "https://example.com/source", publishedAt: "2026-09-30T12:00:00.000Z", discoveredAt: "2026-10-01T01:00:00.000Z",
    category: "regulatory-compliance", tags: ["监管/执法"], selected: true,
  }],
  all: [],
  hot: { schemaVersion: 1, count: 0, items: [] },
  reports: {
    daily: { index: [], details: {} }, weekly: { index: [], details: {} }, monthly: { index: [], details: {} },
  },
  topics: { groups: [], topics: [] },
  leadCandidates: [],
  references: [],
} as PublicSnapshot;

test("writePublicSite writes a self-contained static edition and preserves snapshot values as JSON", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "lawhot-public-site-"));
  try {
    await writePublicSite(dir, snapshot);
    assert.deepEqual((await readdir(dir)).sort(), [".nojekyll", "app.css", "app.js", "data.json", "index.html", "logo.svg"]);
    const [html, data, nojekyll] = await Promise.all([
      readFile(path.join(dir, "index.html"), "utf8"),
      readFile(path.join(dir, "data.json"), "utf8"),
      readFile(path.join(dir, ".nojekyll"), "utf8"),
    ]);
    assert.match(html, /href="\.\/app\.css"/);
    assert.match(html, /src="\.\/app\.js"/);
    assert.match(html, /src="\.\/logo\.svg"/);
    assert.equal(html.includes(hostile), false, "snapshot text is never interpolated into HTML");
    assert.equal(nojekyll, "");
    const parsed = JSON.parse(data) as PublicSnapshot;
    assert.equal(parsed.site.description, hostile);
    assert.equal(parsed.selected[0]!.title, hostile);
    assert.equal(parsed.selected[0]!.publishedAt, "2026-09-30T12:00:00.000Z", "original dates are not replaced by build time");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("browser assets read only relative static data and render untrusted values as text", async () => {
  const [html, script] = await Promise.all([
    readFile(new URL("../static/index.html", import.meta.url), "utf8"),
    readFile(new URL("../static/app.js", import.meta.url), "utf8"),
  ]);
  assert.match(script, /fetch\("\.\/data\.json"/);
  assert.doesNotMatch(script, /fetch\([^)]*\/api\//);
  assert.doesNotMatch(script, /innerHTML|outerHTML|insertAdjacentHTML|document\.write/);
  assert.match(script, /\.textContent\s*=/);
  assert.match(script, /url\.protocol !== "http:" && url\.protocol !== "https:"/);
  assert.match(script, /host === "localhost"/);
  assert.doesNotMatch(html, /(?:src|href)="\/(?!\/)/, "all first-party assets are relative to the repository subpath");
});
