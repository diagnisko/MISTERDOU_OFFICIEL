"use client";

import { Reveal, SectionLabel } from "./lux-fx";
import { IconCard, IconFingerprint, IconShield } from "./lux-icons";

const ITEMS = [
  {
    icon: IconShield,
    title: "Paiement Wave / Orange Money, côté serveur",
    body: "Chaque transaction est validée par notre serveur — jamais dans le navigateur. Le produit n'est livré qu'après confirmation du paiement.",
  },
  {
    icon: IconFingerprint,
    title: "Identifiants protégés",
    body: "E-mails et mots de passe sont chiffrés (AES-256-GCM) et remis uniquement sur votre espace sécurisé, après vérification d'identité.",
  },
  {
    icon: IconCard,
    title: "Comptant ou mensualités",
    body: "Payez en une fois, ou échelonnez selon le compte. Flexibilité totale, encadrée par des règles strictes côté serveur.",
  },
];

export function LuxWhy() {
  return (
    <section id="pourquoi" className="relative px-5 py-24 md:px-8 md:py-32">
      <div className="mx-auto max-w-6xl">
        <Reveal>
          <SectionLabel>Pourquoi MISTERDOU</SectionLabel>
        </Reveal>
        <Reveal delay={0.08}>
          <h2 className="lux-h2 mt-5 max-w-2xl text-stone-100">
            La rigueur d'une banque, <em className="lux-gold-text">l'élégance</em> du jeu.
          </h2>
        </Reveal>

        <div className="mt-14 grid gap-5 md:grid-cols-3">
          {ITEMS.map((item, i) => (
            <Reveal key={item.title} delay={0.1 + i * 0.09}>
              <article className="lux-glass lux-glass-sheen group h-full rounded-[24px] p-7 transition-colors">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-[rgba(245,158,11,0.35)] bg-[rgba(245,158,11,0.08)] text-[var(--lux-gold)]">
                  <item.icon className="h-6 w-6" aria-hidden />
                </div>
                <h3 className="lux-serif mt-6 text-[21px] font-semibold text-stone-100">{item.title}</h3>
                <p className="mt-3 text-[14px] leading-relaxed text-stone-400">{item.body}</p>
              </article>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}