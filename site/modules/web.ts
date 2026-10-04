// What the site's modules add to the web pages (site/modules/index.ts).
import type { WebModule } from "@aihot/web/modules";
import { leadsWebModule } from "../../modules/leads/web-module.tsx";

export const WEB_MODULES: readonly WebModule[] = [leadsWebModule];
