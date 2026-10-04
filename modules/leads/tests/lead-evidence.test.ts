import assert from "node:assert/strict";
import test from "node:test";
import { loadLeadEvidence } from "@aihot/backend/publication/lead-evidence";

test("人工参考只返回匹配的公开事件", () => {
  const result = loadLeadEvidence({ q: "环境", practice: "compliance" });
  assert.ok(result.items.length > 0);
  assert.ok(result.items.every((item) => item.category === "compliance"));
  assert.ok(result.items.every((item) => item.status === "pending_review" && item.referenceOnly));
  assert.ok(result.items.every((item) => item.sourceUrl.startsWith("https://")));
});

test("人工参考不把不匹配的内容当成线索", () => {
  assert.deepEqual(loadLeadEvidence({ q: "不存在的关键词", practice: "all" }).items, []);
  assert.deepEqual(loadLeadEvidence({ q: "环境", practice: "labor" }).items, []);
});
