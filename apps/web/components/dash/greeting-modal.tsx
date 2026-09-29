"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { GREETING_EVENT, takeGreeting, type Greeting } from "@/lib/greeting";
import { useT } from "@/lib/i18n";
import { IconBadgeCheck, IconChat, IconClock, IconClose, IconSpark } from "./dash-icons";

const LONG_ABSENCE_DAYS = 30;

function sinceLabel(iso: string, t: ReturnType<typeof useT>) {
  const then = new Date(iso);
  const days = Math.floor((Date.now() - then.getTime()) / 86_400_000);
  const when = then.toLocaleString(t.intl, { weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });
  const ago = days <= 0 ? t("greet.today") : days === 1 ? t("greet.yesterday") : t("greet.daysAgo", { days });
  return { days, text: `${ago} — ${when}` };
}

// Accueil affiché une fois après inscription ou connexion.
export function GreetingModal({ fallbackName }: { fallbackName?: string | null }) {
  const reduce = useReducedMotion();
  const t = useT();
  const [greeting, setGreeting] = useState<Greeting | null>(null);
  const primaryRef = useRef<HTMLAnchorElement | HTMLButtonElement | null>(null);

  // Au chargement, puis à chaque message déposé : après une connexion, la page
  // change sans recharger le site, ce composant reste monté.
  useEffect(() => {
    const check = () => {
      const next = takeGreeting();
      if (next) setGreeting(next);
    };
    check();
    window.addEventListener(GREETING_EVENT, check);
    return () => window.removeEventListener(GREETING_EVENT, check);
  }, []);

  useEffect(() => {
    if (!greeting) return;
    primaryRef.current?.focus();
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && setGreeting(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [greeting]);

  const close = () => setGreeting(null);
  const name = greeting?.firstName || fallbackName || "";

  let title = "";
  let body: React.ReactNode = null;
  let actions: React.ReactNode = null;

  if (greeting?.kind === "welcome") {
    title = name ? t("greet.welcome", { name }) : t("greet.welcomeAnon");
    body = (
      <>
        <p className="mt-2 text-[14px] leading-relaxed text-[#cdbab3]">{t("greet.ready")}</p>
        <ul className="mt-5 space-y-3">
          {[
            { icon: IconBadgeCheck, text: t("greet.tipKyc") },
            { icon: IconSpark, text: t("greet.tipCreds") },
            { icon: IconChat, text: t("greet.tipPassword") },
          ].map(({ icon: Icon, text }) => (
            <li key={text} className="flex gap-3 text-[13px] leading-relaxed text-[#e9dad3]">
              <span className="dash-icon !h-8 !w-8 shrink-0">
                <Icon size={15} />
              </span>
              {text}
            </li>
          ))}
        </ul>
      </>
    );
    actions = (
      <>
        <Link ref={(el) => { primaryRef.current = el; }} href="/identity-verification" onClick={close} className="dash-btn dash-btn-primary flex-1">
          {t("menu.verify")}
        </Link>
        <button type="button" onClick={close} className="dash-btn dash-btn-ghost flex-1">
          {t("greet.later")}
        </button>
      </>
    );
  } else if (greeting?.kind === "return") {
    const since = greeting.previousLoginAt ? sinceLabel(greeting.previousLoginAt, t) : null;
    const longAbsence = since !== null && since.days >= LONG_ABSENCE_DAYS;
    const suffix = name ? `, ${name}` : "";
    title = longAbsence ? t("greet.longTime", { name: suffix }) : t("greet.back", { name: suffix });
    body = (
      <>
        <p className="mt-2 text-[14px] leading-relaxed text-[#cdbab3]">{longAbsence ? t("greet.longLead") : t("greet.shortLead")}</p>
        {since && (
          <div className="mt-5 flex items-start gap-3 rounded-2xl border border-[rgba(255,236,229,0.08)] bg-white/[0.02] p-3.5">
            <span className="dash-icon !h-8 !w-8 shrink-0">
              <IconClock size={15} />
            </span>
            <div className="text-[13px]">
              <p className="text-[#b8a6a1]">{t("greet.lastLogin")}</p>
              <p className="mt-0.5 text-white first-letter:uppercase">{since.text}</p>
            </div>
          </div>
        )}
        <p className="mt-4 text-[12px] leading-relaxed text-[#8f7d77]">
          {t("greet.notYou")}{" "}
          <Link href="/support" onClick={close} className="text-[#ff8a5c] hover:underline">
            {t("greet.alertSupport")}
          </Link>{" "}
          {t("greet.changePassword")}
        </p>
      </>
    );
    actions = (
      <button ref={(el) => { primaryRef.current = el; }} type="button" onClick={close} className="dash-btn dash-btn-primary flex-1">
        {t("greet.continue")}
      </button>
    );
  }

  return (
    <AnimatePresence>
      {greeting && (
        <motion.div
          className="fixed inset-0 z-[100] grid place-items-center bg-black/70 p-4"
          initial={reduce ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={reduce ? undefined : { opacity: 0 }}
          onMouseDown={(event) => event.target === event.currentTarget && close()}
        >
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-labelledby="greeting-title"
            className="dash-card relative w-full max-w-md overflow-hidden p-6 sm:p-7"
            initial={reduce ? false : { opacity: 0, y: 24, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={reduce ? undefined : { opacity: 0, y: 12, scale: 0.98 }}
            transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
          >
            <span aria-hidden className="pointer-events-none absolute -right-16 -top-20 h-56 w-56 rounded-full bg-[radial-gradient(circle,rgba(232,71,36,0.35),transparent_65%)]" />
            <button type="button" onClick={close} aria-label="Fermer" className="absolute right-4 top-4 grid h-8 w-8 place-items-center rounded-full text-[#b8a6a1] transition hover:bg-white/[0.06] hover:text-white">
              <IconClose size={15} />
            </button>
            <p className="lux-serif dash-brand text-[15px] font-bold text-stone-100">
              MISTERDOU<span className="text-[#ff6a32]">.</span>
            </p>
            <h2 id="greeting-title" className="relative mt-4 text-[24px] font-semibold leading-tight text-white">
              {title}
            </h2>
            <div className="relative">{body}</div>
            <div className="relative mt-6 flex flex-col gap-2 sm:flex-row">{actions}</div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
