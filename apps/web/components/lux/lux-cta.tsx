"use client";

import { useRef } from "react";
import Link from "next/link";
import { Magnetic, OrbGlide, Reveal, IgniteHeading } from "./lux-fx";
import { IconArrowRight } from "./lux-icons";

export function LuxCta() {
  const ref = useRef<HTMLElement>(null);

  return (
    <section ref={ref} className="relative overflow-hidden px-5 py-28 md:py-40">
      {/* Orbes parallaxe ±120 px, blush doré */}
      <OrbGlide targetRef={ref} className="left-[8%] top-[12%] h-72 w-72" from={-40} to={120} />
      <OrbGlide targetRef={ref} className="right-[6%] bottom-[6%] h-80 w-80" from={140} to={-100} />
      <OrbGlide targetRef={ref} className="left-[42%] bottom-[18%] h-56 w-56 opacity-60" from={-90} to={70} />

      <div className="relative z-10 mx-auto max-w-3xl text-center">
        <Reveal>
          <span className="lux-glass-chip text-[10px] text-stone-300">Rejoignez le marché sûr</span>
        </Reveal>
        <IgniteHeading
          className="lux-h2 mt-7 text-stone-100"
          parts={[{ text: "Votre carrière mérite des armes" }, { text: " à la hauteur.", accent: true }]}
        />
        <Reveal delay={0.16}>
          <p className="mx-auto mt-6 max-w-xl text-[15px] leading-relaxed text-stone-400">
            Comptes certifiés, identité vérifiée, paiement échelonné. L'achat comme la revente, sans friction,
            sans zone grise.
          </p>
        </Reveal>
        <Reveal delay={0.24}>
          <div className="mt-10 flex flex-col items-center justify-center gap-3.5 sm:flex-row">
            <Magnetic strength={0.35}>
              <Link href="/register" className="lux-btn lux-btn-gold group/btn">
                Créer mon compte
                <IconArrowRight className="h-4 w-4 transition-transform duration-300 group-hover/btn:translate-x-1" aria-hidden />
              </Link>
            </Magnetic>
            <Magnetic strength={0.35}>
              <Link href="/login" className="lux-btn lux-btn-ghost group/btn">
                Se connecter
              </Link>
            </Magnetic>
          </div>
        </Reveal>
      </div>
    </section>
  );
}