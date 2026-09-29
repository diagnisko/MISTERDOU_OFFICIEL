import type { Metadata } from "next";
import type { ReactNode } from "react";
import { getServerT } from "@/lib/i18n-server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getServerT();
  return { title: t("auth.metaRegisterTitle"), description: t("auth.metaRegisterDesc"), robots: { index: false, follow: true } };
}

export default function RegisterLayout({ children }: { children: ReactNode }) {
  return children;
}
