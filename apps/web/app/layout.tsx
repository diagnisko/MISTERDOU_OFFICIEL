import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { Cormorant_Garamond, Montserrat } from "next/font/google";
import "./globals.css";
import { GreetingModal } from "@/components/dash/greeting-modal";
import { PREFERENCES_BOOT_SCRIPT } from "@/lib/preferences-boot";

const serif = Cormorant_Garamond({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  style: ["normal", "italic"],
  variable: "--font-lux-serif",
  display: "swap",
});

const sans = Montserrat({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-lux-sans",
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "MISTERDOU — Comptes eFootball certifiés",
    template: "%s · MISTERDOU",
  },
  description:
    "Achetez et vendez des comptes eFootball en toute sécurité : vérification d'identité, paiement par Wave, support dédié.",
  keywords: ["eFootball", "comptes", "KONAMI", "achat", "vente", "western"],
  robots: "index, follow",
  // Écran d'accueil de l'iPhone : icône, nom et ouverture en plein écran (notifications).
  appleWebApp: { capable: true, title: "MISTERDOU", statusBarStyle: "black-translucent" },
  icons: { apple: "/icons/apple-touch-icon.png" },
};

export const viewport: Viewport = {
  themeColor: "#0b0605",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="fr" dir="ltr" data-theme="dark" className={`dark ${serif.variable} ${sans.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: PREFERENCES_BOOT_SCRIPT }} />
      </head>
      <body className="min-h-screen antialiased">
        {children}
        <GreetingModal />
      </body>
    </html>
  );
}