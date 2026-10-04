"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { IconCheck, IconSliders, IconX } from "./lux-icons";

export type ToolOption = { label: string; href: string; active: boolean };

// « Trier et filtrer » : un seul bouton discret qui ouvre un menu (tri + division),
// au lieu de rangées de pastilles qui mangeaient l'écran sur téléphone.
// Chaque choix est un lien : la page serveur se recharge avec le bon filtre.
export function CatalogueTools({
  label,
  sortTitle,
  sorts,
  divisionTitle,
  divisions,
  changed,
  closeLabel,
}: {
  label: string;
  sortTitle: string;
  sorts: ToolOption[];
  divisionTitle: string;
  divisions: ToolOption[];
  /** Un tri ou un filtre autre que celui par défaut est actif (pastille sur le bouton). */
  changed: boolean;
  closeLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => root.current && !root.current.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={root} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={label}
        className="lux-glass relative flex h-[48px] items-center gap-2 rounded-full border border-white/10 px-[14px] text-stone-200 transition-colors hover:border-[rgba(255,106,50,0.5)] sm:px-5"
      >
        <IconSliders className="h-[18px] w-[18px]" aria-hidden />
        <span className="hidden text-[13px] font-medium sm:inline">{label}</span>
        {changed && (
          <span aria-hidden className="absolute right-[9px] top-[9px] h-2 w-2 rounded-full bg-[var(--lux-gold)] shadow-[0_0_8px_rgba(255,106,50,0.9)]" />
        )}
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            role="menu"
            initial={reduce ? false : { opacity: 0, y: -6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={reduce ? undefined : { opacity: 0, y: -6, scale: 0.98 }}
            transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
            className="absolute right-0 top-[calc(100%+8px)] z-40 w-[min(300px,calc(100vw-40px))] origin-top-right overflow-hidden rounded-[20px] border border-white/10 bg-[#120c0b]/95 p-2 shadow-[0_24px_60px_-20px_rgba(0,0,0,0.9)] backdrop-blur-xl"
          >
            <div className="flex items-center justify-between px-3 pb-1 pt-2">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-stone-500">{sortTitle}</p>
              <button type="button" onClick={() => setOpen(false)} aria-label={closeLabel} className="grid h-8 w-8 place-items-center rounded-full text-stone-400 hover:text-white">
                <IconX className="h-4 w-4" aria-hidden />
              </button>
            </div>
            <Options items={sorts} onPick={() => setOpen(false)} />
            {divisions.length > 2 && (
              <>
                <div className="mx-3 my-2 h-px bg-white/[0.06]" />
                <p className="px-3 pb-1 pt-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-stone-500">{divisionTitle}</p>
                <Options items={divisions} onPick={() => setOpen(false)} />
              </>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function Options({ items, onPick }: { items: ToolOption[]; onPick: () => void }) {
  return (
    <ul className="space-y-0.5">
      {items.map((o) => (
        <li key={o.href}>
          <Link
            href={o.href}
            role="menuitemradio"
            aria-checked={o.active}
            onClick={onPick}
            className={`flex items-center justify-between rounded-[12px] px-3 py-2.5 text-[14px] transition-colors ${
              o.active ? "bg-[rgba(232,71,36,0.14)] text-white" : "text-stone-300 hover:bg-white/[0.05] hover:text-white"
            }`}
          >
            {o.label}
            {o.active && <IconCheck className="h-4 w-4 text-[var(--lux-gold-light)]" aria-hidden />}
          </Link>
        </li>
      ))}
    </ul>
  );
}
