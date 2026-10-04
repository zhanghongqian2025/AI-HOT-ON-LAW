import { defineServerModule } from "@aihot/backend/modules";
import { registerLeadEvidenceRoutes } from "./api/routes.ts";

export const leadsServerModule = defineServerModule({
  name: "leads",
  http: registerLeadEvidenceRoutes,
});
