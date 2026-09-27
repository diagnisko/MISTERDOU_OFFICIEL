import type { ReactNode } from "react";

// ---------------------------------------------------------------------------
// Primitives pures de l’univers Lux — aucun hook, aucune animation.
// Elles vivent hors de `lux-fx` (qui importe motion) afin que les écrans sans
// animation (admin, compte, KYC, checkout…) ne téléchargent pas framer-motion.
// ---------------------------------------------------------------------------

export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

// Étiquette de section : kicker uppercase espacé + filet or.
export function SectionLabel({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={`flex items-center gap-4 ${className ?? ""}`}>
      <span className="lux-line w-10 shrink-0" aria-hidden />
      <span className="lux-kicker">{children}</span>
    </div>
  );
}
