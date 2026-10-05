import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import vm from "node:vm";
import { parseHTML } from "linkedom";
import type { PublicSnapshot } from "../types.ts";
import { writePublicSite } from "../render.ts";

const hostile = `</script><img src=x onerror="globalThis.pwned=true">`;

const snapshot = {
  schemaVersion: 1,
  site: { name: "法律案源线索", description: hostile },
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
    const [html, script, styles, data, nojekyll] = await Promise.all([
      readFile(path.join(dir, "index.html"), "utf8"),
      readFile(path.join(dir, "app.js"), "utf8"),
      readFile(path.join(dir, "app.css"), "utf8"),
      readFile(path.join(dir, "data.json"), "utf8"),
      readFile(path.join(dir, ".nojekyll"), "utf8"),
    ]);
    const scriptVersion = createHash("sha256").update(script).digest("hex").slice(0, 12);
    const styleVersion = createHash("sha256").update(styles).digest("hex").slice(0, 12);
    assert.match(html, new RegExp(`href="\\./app\\.css\\?v=${styleVersion}"`));
    assert.match(html, new RegExp(`src="\\./app\\.js\\?v=${scriptVersion}"`));
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

test("asset content changes produce a different versioned index without changing filenames", async () => {
  const fixture = await mkdtemp(path.join(os.tmpdir(), "lawhot-public-render-fixture-"));
  try {
    const staticDir = path.join(fixture, "static");
    const destination = path.join(fixture, "output");
    await mkdir(staticDir);
    const renderSource = await readFile(new URL("../render.ts", import.meta.url), "utf8");
    await Promise.all([
      writeFile(path.join(fixture, "render.ts"), renderSource),
      writeFile(path.join(staticDir, "index.html"), '<link href="./app.css"><script src="./app.js"></script>'),
      writeFile(path.join(staticDir, "app.js"), "console.log('first');\n"),
      writeFile(path.join(staticDir, "app.css"), "body { color: black; }\n"),
      writeFile(path.join(staticDir, "logo.svg"), "<svg></svg>\n"),
    ]);
    const fixtureModule = await import(pathToFileURL(path.join(fixture, "render.ts")).href) as typeof import("../render.ts");
    await fixtureModule.writePublicSite(destination, snapshot);
    const firstIndex = await readFile(path.join(destination, "index.html"), "utf8");

    await writeFile(path.join(staticDir, "app.js"), "console.log('second');\n");
    await fixtureModule.writePublicSite(destination, snapshot);
    const secondIndex = await readFile(path.join(destination, "index.html"), "utf8");

    assert.notEqual(secondIndex, firstIndex);
    assert.deepEqual((await readdir(destination)).sort(), [".nojekyll", "app.css", "app.js", "data.json", "index.html", "logo.svg"]);
    const changedScript = await readFile(path.join(destination, "app.js"), "utf8");
    const changedVersion = createHash("sha256").update(changedScript).digest("hex").slice(0, 12);
    assert.match(secondIndex, new RegExp(`src="\\./app\\.js\\?v=${changedVersion}"`));
  } finally {
    await rm(fixture, { recursive: true, force: true });
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

test("all route executes with categorized items, newest first and Chinese category options", async () => {
  const [html, script] = await Promise.all([
    readFile(new URL("../static/index.html", import.meta.url), "utf8"),
    readFile(new URL("../static/app.js", import.meta.url), "utf8"),
  ]);
  const { document, window } = parseHTML(html);
  const location = { hash: "#/all" };
  const allSnapshot = {
    ...snapshot,
    selected: [],
    all: [
      {
        ...snapshot.selected[0]!,
        id: "older-compliance",
        title: "一月监管动态",
        category: "regulatory-compliance",
        publishedAt: "2026-01-10T00:00:00.000Z",
      },
      {
        ...snapshot.selected[0]!,
        id: "newest-bankruptcy",
        title: "三月破产公告",
        category: "bankruptcy-restructuring",
        publishedAt: "2026-03-10T00:00:00.000Z",
      },
      {
        ...snapshot.selected[0]!,
        id: "discovered-compliance",
        title: "二月发现的监管资料",
        category: "regulatory-compliance",
        publishedAt: null,
        discoveredAt: "2026-02-10T00:00:00.000Z",
      },
    ],
  } satisfies PublicSnapshot;
  window.scrollTo = () => {};
  const Option = function (this: unknown, text: string, value: string) {
    const option = document.createElement("option");
    option.textContent = text;
    option.value = value;
    return option;
  };
  vm.runInNewContext(script, {
    console,
    document,
    fetch: async () => ({ ok: true, json: async () => allSnapshot }),
    history: { replaceState: () => {} },
    Intl,
    location,
    Option,
    URL,
    window,
  }, { filename: "public-snapshot-app.js" });
  await new Promise<void>((resolve) => setImmediate(resolve));

  assert.equal(document.querySelector("#page-title")?.textContent, "全部");
  assert.deepEqual(
    [...document.querySelectorAll("#page .card h2")].map((heading) => heading.textContent),
    ["三月破产公告", "二月发现的监管资料", "一月监管动态"],
  );
  const categoryOptions = [...document.querySelectorAll("#page select option")].map((option) => option.textContent);
  assert.equal(categoryOptions[0], "全部分类");
  assert.deepEqual(new Set(categoryOptions.slice(1)), new Set(["破产重整", "监管合规"]));
  assert.deepEqual(
    [...document.querySelectorAll("#page .card .badge")].map((badge) => badge.textContent),
    ["破产重整", "监管合规", "监管合规"],
  );
});
