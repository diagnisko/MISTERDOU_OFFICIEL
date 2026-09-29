"use client";

import { Reveal, SectionLabel, IgniteHeading } from "./lux-fx";
import { IconCard, IconFingerprint, IconShield } from "./lux-icons";
import { useT, type MessageKey } from "@/lib/i18n";

const ITEMS = [
  {
    icon: IconShield,
    title: "why.payTitle" as MessageKey,
    body: "why.payBody" as MessageKey,
  },
  {
    icon: IconFingerprint,
    title: "why.credsTitle" as MessageKey,
    body: "why.credsBody" as MessageKey,
  },
  {
    icon: IconCard,
    title: "why.splitTitle" as MessageKey,
    body: "why.splitBody" as MessageKey,
  },
];

export function LuxWhy() {
  const t = useT();
  return (
    <section id="pourquoi" className="relative px-5 py-24 md:px-8 md:py-32">
      <div className="mx-auto max-w-6xl">
        <Reveal>
          <SectionLabel>{t("why.label")}</SectionLabel>
        </Reveal>
        <IgniteHeading
          className="lux-h2 mt-5 max-w-2xl text-stone-100"
          parts={[{ text: t("why.h1") }, { text: t("why.h2"), accent: true }, { text: t("why.h3") }]}
        />

        <div className="mt-14 grid gap-5 md:grid-cols-3">
          {ITEMS.map((item, i) => (
            <Reveal key={item.title} delay={0.1 + i * 0.09}>
              <article className="lux-glass lux-glass-sheen group h-full rounded-[24px] p-7 transition-colors">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-[rgba(232,71,36,0.35)] bg-[rgba(232,71,36,0.08)] text-[var(--lux-gold)]">
                  <item.icon className="h-6 w-6" aria-hidden />
                </div>
                <h3 className="lux-serif mt-6 text-[21px] font-semibold text-stone-100">{t(item.title)}</h3>
                <p className="mt-3 text-[14px] leading-relaxed text-stone-400">{t(item.body)}</p>
              </article>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}