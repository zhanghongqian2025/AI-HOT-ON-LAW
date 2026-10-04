import type { FastifyInstance, FastifyRequest } from "fastify";
import { isLeadEvidencePractice, loadLeadEvidence } from "@aihot/backend/publication/lead-evidence";
import { looseQuery, sendJsonWithEtag, sendProblem } from "@aihot/api/http/respond";

export function registerLeadEvidenceRoutes(app: FastifyInstance): void {
  app.get("/api/site/lead-evidence", async (req, reply) => {
    const query = looseQuery(req as FastifyRequest);
    const practice = query.practice || "all";
    if (practice !== "all" && !isLeadEvidencePractice(practice)) {
      return sendProblem(req, reply, { status: 400, code: "invalid_request", detail: "invalid practice" });
    }
    const body = loadLeadEvidence({ q: query.q ?? "", practice });
    return sendJsonWithEtag(req, reply, body, { etagPrefix: "lead-evidence", cacheControl: "public, max-age=300, s-maxage=300" });
  });
}
