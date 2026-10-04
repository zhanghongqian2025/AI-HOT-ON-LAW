import { defineModule } from "@aihot/contracts/modules";

export const leadsModule = defineModule({
  name: "leads",
  pages: [{ path: "leads", file: "web.tsx" }],
  apiPaths: [/^\/api\/site\/lead-evidence$/],
});
