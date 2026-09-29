"use client";

import Image from "next/image";
import Link from "next/link";
import { motion, useReducedMotion } from "motion/react";
import type { ReactNode } from "react";
import { IconCheck } from "@/components/dash/dash-icons";
import { useT, type MessageKey } from "@/lib/i18n";

// Pages d'authentification : l'illustration du hero (logo posé) d'un côté,
// le formulaire de l'autre, dans le langage des tableaux de bord.
// Une seule entrée orchestrée, respectueuse de prefers-reduced-motion.

export const fieldLabelClass = "mb-1.5 block text-[13px] text-[#b8a6a1]";

export const inputClass =
  "w-full min-h-[46px] rounded-xl border border-[rgba(255,236,229,0.1)] bg-white/[0.035] px-4 text-sm text-[var(--lux-text)] outline-none transition placeholder:text-[#8a7771] focus:border-[rgba(255,106,50,0.55)] focus:bg-white/[0.055] focus:ring-2 focus:ring-[rgba(232,71,36,0.18)]";

const TRUST_LINES: MessageKey[] = ["auth.trust1", "auth.trust2", "auth.trust3"];

// Frame sans lettrage : un logo recadré en portrait se lirait tronqué.
const ART = "/hero-scroll/frame-01.jpg";

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
  const t = useT();
  const rise = (delay: number) =>
    reduce
      ? {}
      : {
          initial: { opacity: 0, y: 16 },
          animate: { opacity: 1, y: 0 },
          transition: { duration: 0.6, delay, ease: [0.22, 1, 0.36, 1] as const },
        };

  return (
    <div data-lux className="dash-root">
      <div className="grid min-h-screen lg:grid-cols-[1.08fr_1fr]">
        <aside data-surface="dark" className="relative hidden overflow-hidden lg:block" aria-hidden>
          <motion.div
            className="absolute inset-0"
            {...(reduce ? {} : { initial: { scale: 1.08, opacity: 0 }, animate: { scale: 1, opacity: 1 }, transition: { duration: 1.4, ease: [0.22, 1, 0.36, 1] } })}
          >
            <Image src={ART} alt="" fill priority sizes="55vw" className="object-cover object-[50%_20%]" />
          </motion.div>
          <div className="absolute inset-0 bg-[linear-gradient(90deg,transparent_55%,#050303_100%),linear-gradient(180deg,rgba(5,3,3,0.2)_0%,transparent_35%,rgba(5,3,3,0.92)_100%)]" />
          <div className="absolute inset-x-0 bottom-0 p-12 xl:p-16">
            <motion.p {...rise(0.3)} className="text-[14px] text-white/70">
              {t("auth.artKicker")}
            </motion.p>
            <motion.h2 {...rise(0.38)} className="lux-serif dash-brand mt-3 max-w-[16ch] text-[44px] font-semibold leading-[1.05] text-white">
              {t("auth.artTitle")}
            </motion.h2>
            <motion.ul {...rise(0.48)} className="mt-8 space-y-3">
              {TRUST_LINES.map((line) => (
                <li key={line} className="flex items-center gap-3 text-[14px] text-white/80">
                  <span className="grid h-6 w-6 place-items-center rounded-full border border-white/25 bg-black/30">
                    <IconCheck size={13} className="text-[#ff8a5c]" />
                  </span>
                  {t(line)}
                </li>
              ))}
            </motion.ul>
          </div>
        </aside>

        <main className="relative flex flex-col">
          <div className="relative h-44 overflow-hidden lg:hidden" aria-hidden>
            <Image src={ART} alt="" fill priority sizes="100vw" className="object-cover object-[50%_30%]" />
            <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(5,3,3,0.1)_0%,#050303_100%)]" />
          </div>

          <div className="flex flex-1 items-center justify-center px-5 pb-16 pt-6 sm:px-8 lg:py-16">
            <div className="w-full max-w-[420px]">
              <motion.div {...rise(0.05)}>
                <Link href="/" className="lux-serif dash-brand text-[22px] font-bold text-stone-50">
                  MISTERDOU<span className="text-[#ff6a32]">.</span>
                </Link>
                <p className="mt-8 text-[14px] text-[#b8a6a1]">{kicker}</p>
                <h1 className="mt-1 text-[30px] font-semibold leading-tight tracking-[-0.01em] text-white">{title}</h1>
                <p className="mt-2 text-[14px] leading-relaxed text-[#b8a6a1]">{lead}</p>
              </motion.div>

              <motion.div {...rise(0.14)} className="dash-card mt-7 p-6 sm:p-7">
                {children}
              </motion.div>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
