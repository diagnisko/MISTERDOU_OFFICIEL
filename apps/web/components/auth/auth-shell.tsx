"use client";

import Link from "next/link";
import { motion, useReducedMotion } from "motion/react";
import type { ReactNode } from "react";

// Shell des pages d'auth — univers [data-lux] (slate & or).
// Composition : volet manifeste à gauche (desktop), carte verre centrée à droite.
// Une seule chorégraphie d'entrée (stagger), respectueuse de prefers-reduced-motion.

export const fieldLabelClass =
  "mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--lux-muted)]";

export const inputClass =
  "w-full rounded-xl border border-white/10 bg-white/[0.045] px-4 py-3 text-sm text-[var(--lux-text)] outline-none transition placeholder:text-[#64748b] focus:border-[rgba(245,158,11,0.55)] focus:bg-white/[0.065] focus:ring-2 focus:ring-[rgba(245,158,11,0.16)]";

const TRUST_LINES = [
  "Vendeurs vérifiés, comptes certifiés",
  "Paiement sécurisé — Wave et Orange Money",
  "Livraison accompagnée, support dédié",
];

export function AuthShell({
  kicker,
  title,
  lead,
  children,
}: {
  kicker: string;
  title: string;
  lead: string;
  children: ReactNode;
}) {
  const reduce = useReducedMotion();
  const rise = (delay: number) =>
    reduce
      ? {}
      : {
          initial: { opacity: 0, y: 16 },
          animate: { opacity: 1, y: 0 },
          transition: { duration: 0.55, delay, ease: [0.22, 1, 0.36, 1] as const },
        };

  return (
    <div data-lux className="relative min-h-screen overflow-x-clip text-stone-100">
      <div className="lux-bg" aria-hidden />

      <Link
        href="/"
        className="lux-serif lux-gold-text fixed left-6 top-5 z-20 text-sm font-semibold tracking-[0.34em] transition-opacity hover:opacity-80 sm:left-10 sm:top-7"
      >
        MISTERDOU
      </Link>

      <div className="relative z-10 grid min-h-screen lg:grid-cols-[1.05fr_1fr]">
        <aside className="relative hidden overflow-hidden border-r border-[var(--lux-line)] px-12 lg:flex lg:flex-col lg:justify-center xl:px-20">
          <div
            className="lux-particle"
            style={{ width: 10, height: 10, left: "76%", top: "22%", ["--dur" as string]: "9s", ["--o" as string]: 0.55 }}
            aria-hidden
          />
          <div
            className="lux-particle"
            style={{ width: 6, height: 6, left: "16%", top: "72%", ["--dur" as string]: "7s", ["--o" as string]: 0.4 }}
            aria-hidden
          />

          <motion.h2 {...rise(0.05)} className="lux-h2 max-w-[15ch]">
            Des comptes certifiés, des transactions maîtrisées.
          </motion.h2>
          <motion.p
            {...rise(0.14)}
            className="mt-6 max-w-[46ch] text-sm leading-relaxed text-[var(--lux-muted)]"
          >
            Chaque vendeur est vérifié, chaque paiement est protégé. La place de marché
            eFootball pensée pour durer.
          </motion.p>

          <motion.ul {...rise(0.24)} className="mt-11 space-y-4">
            {TRUST_LINES.map((line) => (
              <li key={line} className="flex items-center gap-4 text-sm text-[var(--lux-muted-strong)]">
                <span className="h-px w-7 bg-[rgba(245,158,11,0.55)]" aria-hidden />
                {line}
              </li>
            ))}
          </motion.ul>
        </aside>

        <main className="flex items-center justify-center px-5 py-24 sm:px-8">
          <motion.div
            {...rise(0.08)}
            className="lux-glass lux-glass-sheen w-full max-w-[440px] rounded-[28px] p-7 sm:p-9"
          >
            <p className="lux-kicker">{kicker}</p>
            <h1 className="lux-serif mt-4 text-[2.3rem] font-semibold leading-[1.08]">{title}</h1>
            <p className="mt-2.5 text-sm leading-relaxed text-[var(--lux-muted)]">{lead}</p>
            <div className="mt-7">{children}</div>
          </motion.div>
        </main>
      </div>
    </div>
  );
}
