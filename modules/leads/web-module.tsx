import { defineWebModule } from "@aihot/web/modules";
import { IconSearch } from "@aihot/web/components/icons";

export const leadsWebModule = defineWebModule({
  name: "leads",
  sidebar: {
    section: "律师工具",
    items: [{ to: "/leads", label: "案源线索", icon: IconSearch }],
  },
  tabs: [{ key: "leads", to: "/leads", label: "线索", icon: IconSearch }],
});
