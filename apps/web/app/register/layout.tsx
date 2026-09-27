import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Créer un compte",
  description: "Rejoignez MISTERDOU — inscription par e-mail ou avec Google.",
  robots: { index: false, follow: true },
};

export default function RegisterLayout({ children }: { children: ReactNode }) {
  return children;
}
