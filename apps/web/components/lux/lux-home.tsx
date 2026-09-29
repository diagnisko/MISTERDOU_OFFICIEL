"use client";

import { LuxProvider, LuxPerfLed } from "@/components/lux/lux-data";
import { LuxNav } from "@/components/lux/lux-nav";
import { LuxHero } from "@/components/lux/lux-hero";
import { LuxMarquee } from "@/components/lux/lux-marquee";
import { LuxWhy } from "@/components/lux/lux-why";
import { LuxFeatured } from "@/components/lux/lux-featured";
import { LuxHow } from "@/components/lux/lux-how";
import { LuxPricing } from "@/components/lux/lux-pricing";
import { LuxCta } from "@/components/lux/lux-cta";
import { LuxFooter } from "@/components/lux/lux-footer";

export function LuxHome() {
  return (
    <LuxProvider>
      <div data-lux className="relative min-h-screen overflow-x-clip text-stone-100">
        <div className="lux-bg" aria-hidden />

        <LuxNav />
        <main className="relative z-10">
          <LuxHero />
          <LuxMarquee />
          <LuxWhy />
          <div className="lux-defer">
            <LuxFeatured />
            <LuxHow />
            <LuxPricing />
            <LuxCta />
          </div>
        </main>
        <div className="lux-defer">
          <LuxFooter />
        </div>

        <LuxPerfLed />
      </div>
    </LuxProvider>
  );
}