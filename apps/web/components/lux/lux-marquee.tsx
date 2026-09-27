"use client";

import { IconStar } from "./lux-icons";

const WORDS = ["Division 1", "Legend", "Ikon", "Epic", "Division 2", "Élite Or", "Rare", "Certifié"];

function Star() {
  return <IconStar filled className="lux-marquee-star" aria-hidden />;
}

// Marquee serif italic en continu — 30 s linéaire, bordures haute/basse.
export function LuxMarquee() {
  const row = (
    <>
      {WORDS.map((w) => (
        <span key={w} className="flex items-center">
          <span className="lux-marquee-item whitespace-nowrap px-8">{w}</span>
          <Star />
        </span>
      ))}
    </>
  );
  return (
    <div className="lux-marquee py-5" aria-hidden>
      <div className="lux-marquee-track">
        <span className="flex shrink-0 items-center">{row}</span>
        <span className="flex shrink-0 items-center">{row}</span>
      </div>
    </div>
  );
}