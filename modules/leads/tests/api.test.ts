import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";
import { registerLeadEvidenceRoutes } from "../api/routes.ts";

test("lead evidence site API filters curated references", async (t) => {
  const app = Fastify({ logger: false });
  registerLeadEvidenceRoutes(app);
  t.after(() => app.close());
  const response = await app.inject({ method: "GET", url: "/api/site/lead-evidence?q=环境&practice=compliance" });
  assert.equal(response.statusCode, 200);
  assert.match(response.headers["cache-control"] ?? "", /public/);
  const body = response.json();
  assert.ok(body.items.length > 0);
  assert.ok(body.items.every((item: { category: string }) => item.category === "compliance"));
});

test("lead evidence site API rejects an unknown practice", async (t) => {
  const app = Fastify({ logger: false });
  registerLeadEvidenceRoutes(app);
  t.after(() => app.close());
  const response = await app.inject({ method: "GET", url: "/api/site/lead-evidence?practice=unknown" });
  assert.equal(response.statusCode, 400);
  assert.equal(response.json().code, "invalid_request");
});
