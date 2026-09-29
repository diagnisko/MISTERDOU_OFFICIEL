"use client";

import { useRef } from "react";
import Link from "next/link";
import { Magnetic, OrbGlide, Reveal, IgniteHeading } from "./lux-fx";
import { IconArrowRight } from "./lux-icons";
import { useT } from "@/lib/i18n";

export function LuxCta() {
  const t = useT();
  const ref = useRef<HTMLElement>(null);

  return (
    <section ref={ref} className="relative overflow-hidden px-5 py-28 md:py-40">
      {/* Orbes parallaxe ±120 px, blush doré */}
      <OrbGlide targetRef={ref} className="left-[8%] top-[12%] h-72 w-72" from={-40} to={120} />
      <OrbGlide targetRef={ref} className="right-[6%] bottom-[6%] h-80 w-80" from={140} to={-100} />
      <OrbGlide targetRef={ref} className="left-[42%] bottom-[18%] h-56 w-56 opacity-60" from={-90} to={70} />

      <div className="relative z-10 mx-auto max-w-3xl text-center">
        <Reveal>
          <span className="lux-glass-chip text-[10px] text-stone-300">{t("cta.chip")}</span>
        </Reveal>
        <IgniteHeading
          className="lux-h2 mt-7 text-stone-100"
          parts={[{ text: t("cta.h1") }, { text: t("cta.h2"), accent: true }]}
        />
        <Reveal delay={0.16}>
          <p className="mx-auto mt-6 max-w-xl text-[15px] leading-relaxed text-stone-400">
            {t("cta.lead")}
          </p>
        </Reveal>
        <Reveal delay={0.24}>
          <div className="mt-10 flex flex-col items-center justify-center gap-3.5 sm:flex-row">
            <Magnetic strength={0.35}>
              <Link href="/register" className="lux-btn lux-btn-gold group/btn">
                {t("home.createAccount")}
                <IconArrowRight className="h-4 w-4 transition-transform duration-300 group-hover/btn:translate-x-1" aria-hidden />
              </Link>
            </Magnetic>
            <Magnetic strength={0.35}>
              <Link href="/login" className="lux-btn lux-btn-ghost group/btn">
                {t("auth.login")}
              </Link>
            </Magnetic>
          </div>
        </Reveal>
      </div>
    </section>
  );
}