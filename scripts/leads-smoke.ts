// First-version public reference corpus and search, without any model/provider calls.
import assert from "node:assert/strict";
const base = process.argv[2] ?? "http://127.0.0.1:3000";
async function html(path: string) {
  const response = await fetch(new URL(path, base), { signal: AbortSignal.timeout(20_000) });
  assert.equal(response.status, 200, path);
  return response.text();
}
const home = await html("/");
assert.ok(home.includes('/leads'), "home links to leads");
const page = await html("/leads");
assert.ok(page.includes("法律案源线索"));
assert.ok(!page.includes("法律案源线索搜索"), "product name stays consistent");
const results = await html("/leads?q=" + encodeURIComponent("环评") + "&practice=compliance");
assert.ok(results.includes("环评信用"), "verified public reference can be searched");
assert.ok(results.includes("待人工核验"));
assert.ok(results.includes("非实时"));
assert.ok(results.includes("www.mee.gov.cn"));
const filtered = await html("/leads?q=" + encodeURIComponent("环评") + "&practice=labor");
assert.ok(!filtered.includes("环评信用黑名单通报涉及建设项目报告质量问题"), "practice filter excludes unrelated reference");
console.log("leads smoke: homepage, search, original source, review state, non-real-time label and practice filter passed");
