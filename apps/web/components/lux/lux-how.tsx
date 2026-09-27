"use client";

import { motion, useReducedMotion } from "motion/react";
import Link from "next/link";
import { Reveal, SectionLabel } from "./lux-fx";
import { IconArrowRight, IconCheck, IconLock, IconCard, IconPhone } from "./lux-icons";

const STEPS = [
  {
    icon: IconPhone,
    n: "01",
    title: "Inscription",
    body: "Créez votre compte avec votre numéro de téléphone. Un code à usage unique le sécurise immédiatement.",
  },
  {
    icon: IconCheck,
    n: "02",
    title: "Vérification d'identité",
    body: "Document d'identité et localisation vérifiés par notre équipe en quelques heures. Rien d'aléatoire.",
  },
  {
    icon: IconCard,
    n: "03",
    title: "Paiement Wave / Orange Money",
    body: "Réglez comptant ou par mensualités. La confirmation vient du serveur, toujours. Jamais de votre navigateur.",
  },
  {
    icon: IconLock,
    n: "04",
    title: "Réception sécurisée",
    body: "Les identifiants, chiffrés de bout en bout, arrivent sur votre espace uniquement après paiement confirmé.",
  },
];

export function LuxHow() {
  const reduce = useReducedMotion();

  return (
    <section id="parcours" className="relative px-5 py-24 md:px-8 md:py-32">
      <div className="mx-auto max-w-6xl">
        <Reveal>
          <SectionLabel>Comment ça marche</SectionLabel>
        </Reveal>
        <Reveal delay={0.08}>
          <h2 className="lux-h2 mt-5 max-w-2xl text-stone-100">
            Quatre étapes. <em className="lux-gold-text">Zéro compromis</em>.
          </h2>
        </Reveal>

        <div className="relative mt-16">
          {/* Ligne dorée : horizontal desktop, vertical mobile — tracée au scroll */}
          <motion.div
            aria-hidden
            className="absolute left-[calc(12.5%)] right-[calc(12.5%)] top-[26px] hidden h-px origin-left bg-[linear-gradient(90deg,#f5d78e,#f59e0b_45%,#d97706)] md:block"
            initial={reduce ? false : { scaleX: 0 }}
            whileInView={{ scaleX: 1 }}
            viewport={{ once: true, amount: 0.35, margin: "-12% 0px" }}
            transition={{ duration: 1.4, ease: [0.22, 1, 0.36, 1] }}
          />
          <motion.div
            aria-hidden
            className="absolute bottom-6 left-6 top-6 w-px origin-top bg-[linear-gradient(180deg,#f5d78e,#d97706)] md:hidden"
            initial={reduce ? false : { scaleY: 0 }}
            whileInView={{ scaleY: 1 }}
            viewport={{ once: true, amount: 0.25, margin: "0px" }}
            transition={{ duration: 1.4, ease: [0.22, 1, 0.36, 1] }}
          />

          <ol className="grid gap-10 md:grid-cols-4 md:gap-6">
            {STEPS.map((step, i) => (
              <li key={step.n} className="relative">
                <Reveal delay={0.12 + i * 0.1}>
                  <span className="relative z-10 flex h-[52px] w-[52px] items-center justify-center rounded-full border border-[rgba(245,158,11,0.4)] bg-[#222735] text-[var(--lux-gold)] shadow-[0_0_24px_-6px_rgba(245,158,11,0.45)]">
                    <step.icon className="h-5 w-5" aria-hidden />
                  </span>
                  <div className="lux-serif mt-6 text-[40px] font-semibold leading-none text-transparent [-webkit-text-stroke:1px_rgba(245,158,11,0.55)]">
                    {step.n}
                  </div>
                  <h3 className="lux-serif mt-3 text-[20px] font-semibold text-stone-100">{step.title}</h3>
                  <p className="mt-2.5 max-w-xs text-[13.5px] leading-relaxed text-stone-400">{step.body}</p>
                </Reveal>
              </li>
            ))}
          </ol>

          {/* Le détail complet (délais, cas des mensualités, remboursement)
              vit sur sa propre page : l'accueil garde le résumé, pas le
              duplicata — deux versions du même texte divergent toujours. */}
          <Reveal delay={0.1} className="mt-14 flex justify-center">
            <Link href="/comment-ca-marche" className="lux-btn lux-btn-ghost group/btn" style={{ borderRadius: 18 }}>
              Voir le parcours en détail
              <IconArrowRight
                className="h-4 w-4 transition-transform duration-300 group-hover/btn:translate-x-1"
                aria-hidden
              />
            </Link>
          </Reveal>
        </div>
      </div>
    </section>
  );
}