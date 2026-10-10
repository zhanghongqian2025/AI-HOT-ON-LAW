import { defineServerModule } from "@aihot/backend/modules";
import { registerLeadEvidenceRoutes } from "./api/routes.ts";
import { extractPdfAttachment } from "./pdf-attachments.ts";

export const leadsServerModule = defineServerModule({
  name: "leads",
  extractAttachment: extractPdfAttachment,
  http: registerLeadEvidenceRoutes,
});
