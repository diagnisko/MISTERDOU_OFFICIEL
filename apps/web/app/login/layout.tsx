import type { Metadata } from "next";
import type { ReactNode } from "react";
import { getServerT } from "@/lib/i18n-server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getServerT();
  return { title: t("auth.metaLoginTitle"), description: t("auth.metaLoginDesc"), robots: { index: false, follow: true } };
}

export default function LoginLayout({ children }: { children: ReactNode }) {
  return children;
}
