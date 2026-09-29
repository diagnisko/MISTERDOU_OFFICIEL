import type { DashNavItem } from "@/components/dash/dash-ui";
import { IconChat, IconHome, IconLifebuoy, IconList, IconStore, IconUsers } from "@/components/dash/dash-icons";
import type { T } from "@/lib/i18n";

/** Menu de l'espace vendeur, dans la langue choisie. */
export function sellerNav(t: T): DashNavItem[] {
  const group = t("snav.group");
  return [
    { href: "/seller", label: t("snav.overview"), icon: IconHome },
    { href: "/offres", label: t("snav.catalogue"), icon: IconStore },
    { href: "/account", label: t("snav.account"), icon: IconUsers },
    { href: "/seller/messages", label: t("snav.discussions"), icon: IconChat, group },
    { href: "/messages", label: t("snav.teamMessages"), icon: IconChat, group },
    { href: "/notifications", label: t("snav.notifications"), icon: IconList, group },
    { href: "/support", label: t("snav.support"), icon: IconLifebuoy, group },
  ];
}
