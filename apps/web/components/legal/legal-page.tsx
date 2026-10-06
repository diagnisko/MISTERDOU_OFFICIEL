import type { ReactNode } from "react";
import { LuxProvider, LuxPerfLed } from "@/components/lux/lux-data";
import { LuxNav } from "@/components/lux/lux-nav";
import { LuxFooter } from "@/components/lux/lux-footer";
import { SectionLabel } from "@/components/lux/lux-fx";
import { serverApiFetch } from "@/lib/server-api";

// ---------------------------------------------------------------------------
// Pages légales (CGU, confidentialité, mentions légales). L'identité de
// l'exploitant et les règles chiffrées viennent de Console > Paramètres :
// rien n'est codé en dur, un réglage modifié s'affiche aussitôt.
// ---------------------------------------------------------------------------

export type LegalInfo = {
  platformName: string;
  entityName: string | null;
  address: string | null;
  registration: string | null;
  publisher: string | null;
  supportEmail: string | null;
  supportWhatsapp: string | null;
  commissionPercent: number;
  payoutHoldDays: number;
  unpaidOrderExpiryHours: number;
  sellerRegistrationFee: number;
  minWithdrawal: number;
  /** Contrat revendeur : prix des forfaits 6, 12 et 18 mois. */
  contractPrices: { six: number; twelve: number; eighteen: number };
};

const FALLBACK: LegalInfo = {
  platformName: "MISTERDOU",
  entityName: null,
  address: null,
  registration: null,
  publisher: null,
  supportEmail: null,
  supportWhatsapp: null,
  commissionPercent: 15,
  payoutHoldDays: 3,
  unpaidOrderExpiryHours: 24,
  sellerRegistrationFee: 1000,
  minWithdrawal: 1000,
  contractPrices: { six: 5000, twelve: 8000, eighteen: 10000 },
};

export async function fetchLegalInfo(): Promise<LegalInfo> {
  try {
    const res = await serverApiFetch("/api/v1/legal", { headers: { Accept: "application/json" }, cache: "no-store" });
    const payload = (await res.json()) as { ok: boolean; data?: LegalInfo };
    // Fusion avec les valeurs par défaut : un champ absent (API plus ancienne) ne casse pas la page.
    return payload.ok && payload.data ? { ...FALLBACK, ...payload.data } : FALLBACK;
  } catch {
    return FALLBACK;
  }
}

export const fcfa = (n: number) => `${new Intl.NumberFormat("fr-FR").format(n)} FCFA`;

/** Contacts réglés dans la console (e-mail, WhatsApp), sinon la page Aide. */
export function Contact({ info }: { info: LegalInfo }) {
  const parts: ReactNode[] = [];
  if (info.supportEmail) {
    parts.push(
      <a key="mail" href={`mailto:${info.supportEmail}`} className="text-[var(--lux-gold-light)] hover:underline">
        {info.supportEmail}
      </a>,
    );
  }
  if (info.supportWhatsapp) {
    parts.push(
      <a key="wa" href={`https://wa.me/${info.supportWhatsapp.replace(/\D/g, "")}`} className="text-[var(--lux-gold-light)] hover:underline" dir="ltr">
        WhatsApp {info.supportWhatsapp}
      </a>,
    );
  }
  parts.push(
    <a key="support" href="/support" className="text-[var(--lux-gold-light)] hover:underline">
      la page Aide et support
    </a>,
  );
  return (
    <>
      {parts.map((p, i) => (
        <span key={i}>
          {i > 0 && (i === parts.length - 1 ? " ou " : ", ")}
          {p}
        </span>
      ))}
    </>
  );
}

export function LegalPage({ kicker, title, updated, children }: { kicker: string; title: string; updated: string; children: ReactNode }) {
  return (
    <LuxProvider>
      <div data-lux className="relative min-h-screen overflow-x-clip text-stone-100">
        <div className="lux-bg" aria-hidden />
        <LuxNav />
        <main className="relative z-10 px-5 pt-32 md:px-8 md:pt-40">
          <article className="mx-auto max-w-3xl">
            <SectionLabel>{kicker}</SectionLabel>
            <h1 className="lux-h2 mt-5 text-stone-100">{title}</h1>
            <p className="mt-4 text-[13px] text-stone-500">Dernière mise à jour : {updated}</p>
            <div className="lux-glass mt-10 space-y-9 rounded-[24px] p-7 text-[14.5px] leading-relaxed text-stone-300 md:p-10">{children}</div>
          </article>
        </main>
        <div className="mt-8">
          <LuxFooter />
        </div>
        <LuxPerfLed />
      </div>
    </LuxProvider>
  );
}

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h2 className="text-[17px] font-semibold text-stone-100">{title}</h2>
      <div className="mt-3 space-y-3">{children}</div>
    </section>
  );
}

export function Bullets({ items }: { items: ReactNode[] }) {
  return (
    <ul className="list-disc space-y-1.5 ps-5 marker:text-[var(--lux-gold)]">
      {items.map((item, i) => (
        <li key={i}>{item}</li>
      ))}
    </ul>
  );
}
