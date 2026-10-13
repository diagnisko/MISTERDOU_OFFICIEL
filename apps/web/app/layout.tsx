import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import localFont from "next/font/local";
import "./globals.css";
import { GreetingModal } from "@/components/dash/greeting-modal";
import { PREFERENCES_BOOT_SCRIPT } from "@/lib/preferences-boot";

// Polices hébergées dans le projet (app/fonts, jeu « latin » de Google Fonts,
// licence OFL) : la construction du site ne dépend plus de Google Fonts, qui a
// déjà fait échouer une mise en ligne. Polices variables : un fichier par style.
const luxSerif = localFont({
  src: [
    { path: "./fonts/cormorant-garamond-latin.woff2", weight: "500 700", style: "normal" },
    { path: "./fonts/cormorant-garamond-latin-italic.woff2", weight: "500 700", style: "italic" },
  ],
  variable: "--font-lux-serif",
  display: "swap",
  fallback: ["Georgia", "Times New Roman", "serif"],
  adjustFontFallback: "Times New Roman",
});

const luxSans = localFont({
  src: [{ path: "./fonts/montserrat-latin.woff2", weight: "400 700", style: "normal" }],
  variable: "--font-lux-sans",
  display: "swap",
  fallback: ["Arial", "sans-serif"],
  adjustFontFallback: "Arial",
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
  // Logos : app/icon.svg et app/favicon.ico (onglet, Google), app/apple-icon.png (iPhone).
  appleWebApp: { capable: true, title: "MISTERDOU", statusBarStyle: "black-translucent" },
};

export const viewport: Viewport = {
  themeColor: "#0b0605",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="fr" dir="ltr" data-theme="dark" className={`dark ${luxSerif.variable} ${luxSans.variable}`} suppressHydrationWarning>
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