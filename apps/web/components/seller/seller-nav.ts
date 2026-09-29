import type { DashNavItem } from "@/components/dash/dash-ui";
import { IconChat, IconHome, IconLifebuoy, IconList, IconStore, IconUsers } from "@/components/dash/dash-icons";

export const SELLER_NAV: DashNavItem[] = [
  { href: "/seller", label: "Vue d’ensemble", icon: IconHome },
  { href: "/catalogue", label: "Catalogue public", icon: IconStore },
  { href: "/account", label: "Mon compte", icon: IconUsers },
  { href: "/seller/messages", label: "Discussions clients", icon: IconChat, group: "Relation" },
  { href: "/messages", label: "Messages équipe", icon: IconChat, group: "Relation" },
  { href: "/notifications", label: "Notifications", icon: IconList, group: "Relation" },
  { href: "/support", label: "Support", icon: IconLifebuoy, group: "Relation" },
];
