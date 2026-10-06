"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { GREETING_EVENT, takeGreeting, type Greeting } from "@/lib/greeting";
import { useT, type MessageKey } from "@/lib/i18n";
import { IconBadgeCheck, IconCalendar, IconChat, IconClock, IconClose, IconTag } from "./dash-icons";

const LONG_ABSENCE_DAYS = 30;

// Couleurs des confettis : la braise du site, de l'or et un peu de blanc.
const CONFETTI_COLORS = ["#ff6a32", "#ffa070", "#e84724", "#ffd166", "#f5d0a9", "#ffffff"];

function lastVisit(iso: string, t: ReturnType<typeof useT>) {
  const then = new Date(iso);
  const days = Math.floor((Date.now() - then.getTime()) / 86_400_000);
  const time = then.toLocaleTimeString(t.intl, { hour: "2-digit", minute: "2-digit" });
  const when =
    days <= 0
      ? t("greet.todayAt", { time })
      : days === 1
        ? t("greet.yesterdayAt", { time })
        : then.toLocaleDateString(t.intl, { day: "numeric", month: "long" });
  return { days, when };
}

/** Pluie de confettis à l'ouverture (rien si l'utilisateur réduit les animations). */
function Confetti() {
  const pieces = useMemo(
    () =>
      Array.from({ length: 26 }, (_, i) => {
        const angle = (Math.PI * (i + 0.5)) / 26; // éventail vers le bas
        const distance = 110 + ((i * 37) % 120);
        return {
          x: Math.cos(angle) * distance * 1.5,
          y: Math.sin(angle) * distance + 40,
          rotate: ((i * 83) % 360) - 180,
          color: CONFETTI_COLORS[i % CONFETTI_COLORS.length]!,
          round: i % 3 === 0,
          delay: (i % 7) * 0.025,
        };
      }),
    [],
  );
  return (
    <div aria-hidden className="pointer-events-none absolute inset-x-0 top-14 flex justify-center">
      {pieces.map((p, i) => (
        <motion.span
          key={i}
          className="absolute block"
          style={{
            width: p.round ? 7 : 6,
            height: p.round ? 7 : 11,
            borderRadius: p.round ? 999 : 2,
            background: p.color,
          }}
          initial={{ x: 0, y: 0, rotate: 0, opacity: 1, scale: 0.6 }}
          animate={{ x: p.x, y: p.y, rotate: p.rotate * 3, opacity: 0, scale: 1 }}
          transition={{ duration: 1.6, delay: 0.25 + p.delay, ease: [0.16, 1, 0.3, 1] }}
        />
      ))}
    </div>
  );
}

type IconProps = { size?: number; className?: string };

// Icônes au trait, comme la cloche et les messages de l'en-tête.
const IconBox = ({ size = 20, className }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden className={className}>
    <path d="M21 8 12 3 3 8v8l9 5 9-5V8Z" />
    <path d="m3 8 9 5 9-5M12 13v8" />
  </svg>
);
const IconLock = ({ size = 20, className }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden className={className}>
    <rect x="4.5" y="10.5" width="15" height="10" rx="2.5" />
    <path d="M8 10.5V7.5a4 4 0 0 1 8 0v3M12 14.5v2.5" />
  </svg>
);
const IconArrow = ({ size = 16, className }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden className={className}>
    <path d="M5 12h14M13 6l6 6-6 6" />
  </svg>
);

/** Pastille d'icône : fond discret, bord fin, teinte braise. */
function IconTile({ children, small = false }: { children: React.ReactNode; small?: boolean }) {
  return (
    <span
      aria-hidden
      className={`grid shrink-0 place-items-center rounded-xl border border-[rgba(255,160,112,0.22)] bg-[linear-gradient(160deg,rgba(255,106,50,0.14),rgba(255,255,255,0.02))] text-[#ffb08a] transition-colors duration-300 group-hover:border-[rgba(255,160,112,0.5)] group-hover:text-white ${
        small ? "h-8 w-8" : "h-11 w-11"
      }`}
    >
      {children}
    </span>
  );
}

const SHORTCUTS: Array<{ href: string; Icon: (p: IconProps) => React.ReactNode; label: MessageKey }> = [
  { href: "/offres", Icon: IconTag, label: "greet.actOffers" },
  { href: "/account/orders", Icon: IconBox, label: "greet.actOrders" },
  { href: "/pret-ou-prestation", Icon: IconCalendar, label: "greet.actMonthly" },
];

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

  let badge = "🎉";
  let title = "";
  let body: React.ReactNode = null;
  let actions: React.ReactNode = null;

  if (greeting?.kind === "welcome") {
    title = name ? t("greet.welcome", { name }) : t("greet.welcomeAnon");
    body = (
      <>
        <p className="mt-2 text-[14.5px] leading-relaxed text-[#d9c7c0]">{t("greet.ready")}</p>
        <ul className="mt-5 space-y-2.5 text-start">
          {[
            { Icon: IconBadgeCheck, text: t("greet.tipKyc") },
            { Icon: IconLock, text: t("greet.tipCreds") },
            { Icon: IconChat, text: t("greet.tipPassword") },
          ].map(({ Icon, text }) => (
            <li key={text} className="flex items-start gap-3 rounded-2xl border border-white/[0.06] bg-white/[0.025] px-3.5 py-3 text-[13px] leading-relaxed text-[#eadbd4]">
              <IconTile small>
                <Icon size={16} />
              </IconTile>
              <span className="pt-1">{text}</span>
            </li>
          ))}
        </ul>
      </>
    );
    actions = (
      <>
        <Link ref={(el) => { primaryRef.current = el; }} href="/identity-verification" onClick={close} className="dash-btn dash-btn-primary flex-1">
          {t("greet.verifyNow")}
        </Link>
        <button type="button" onClick={close} className="dash-btn dash-btn-ghost flex-1">
          {t("greet.later")}
        </button>
      </>
    );
  } else if (greeting?.kind === "return") {
    const visit = greeting.previousLoginAt ? lastVisit(greeting.previousLoginAt, t) : null;
    const longAbsence = visit !== null && visit.days >= LONG_ABSENCE_DAYS;
    const suffix = name ? `, ${name}` : "";
    badge = longAbsence ? "🥳" : "🎉";
    title = longAbsence ? t("greet.longTime", { name: suffix }) : t("greet.back", { name: suffix });
    body = (
      <>
        <p className="mt-2 text-[14.5px] leading-relaxed text-[#d9c7c0]">{longAbsence ? t("greet.longLead") : t("greet.shortLead")}</p>
        <div className="mt-5 grid grid-cols-3 gap-2">
          {SHORTCUTS.map((s) => (
            <Link
              key={s.href}
              href={s.href}
              onClick={close}
              className="group flex flex-col items-center gap-2 rounded-2xl border border-white/[0.07] bg-white/[0.03] px-2 py-3.5 text-center text-[12px] font-medium text-[#eadbd4] transition hover:-translate-y-0.5 hover:border-[rgba(255,106,50,0.45)] hover:bg-[rgba(255,106,50,0.08)] hover:text-white"
            >
              <IconTile>
                <s.Icon size={20} />
              </IconTile>
              {t(s.label)}
            </Link>
          ))}
        </div>
        {visit && (
          <p className="mt-4 flex items-center justify-center gap-1.5 text-[12px] text-[#8f7d77]">
            <IconClock size={13} />
            {t("greet.lastVisit", { when: visit.when })}
          </p>
        )}
      </>
    );
    actions = (
      <button ref={(el) => { primaryRef.current = el; }} type="button" onClick={close} className="dash-btn dash-btn-primary group flex-1">
        {t("greet.letsGo")}
        <IconArrow className="transition-transform duration-300 group-hover:translate-x-0.5 rtl:rotate-180 rtl:group-hover:-translate-x-0.5" />
      </button>
    );
  }

  return (
    <AnimatePresence>
      {greeting && (
        <motion.div
          className="fixed inset-0 z-[100] grid place-items-center bg-black/75 p-4 backdrop-blur-[2px]"
          initial={reduce ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={reduce ? undefined : { opacity: 0 }}
          onMouseDown={(event) => event.target === event.currentTarget && close()}
        >
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-labelledby="greeting-title"
            className="dash-card relative w-full max-w-md overflow-hidden p-6 text-center sm:p-7"
            initial={reduce ? false : { opacity: 0, y: 28, scale: 0.94 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={reduce ? undefined : { opacity: 0, y: 12, scale: 0.98 }}
            transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
          >
            <span aria-hidden className="pointer-events-none absolute -top-24 left-1/2 h-64 w-64 -translate-x-1/2 rounded-full bg-[radial-gradient(circle,rgba(232,71,36,0.42),transparent_65%)]" />
            {!reduce && <Confetti />}
            <button type="button" onClick={close} aria-label={t("greet.close")} className="absolute end-4 top-4 grid h-8 w-8 place-items-center rounded-full text-[#b8a6a1] transition hover:bg-white/[0.06] hover:text-white">
              <IconClose size={15} />
            </button>

            <motion.div
              className="relative mx-auto grid h-[72px] w-[72px] place-items-center rounded-full border border-[rgba(255,160,112,0.35)] bg-[radial-gradient(circle_at_35%_30%,rgba(255,160,112,0.28),rgba(122,23,18,0.35))] shadow-[0_0_40px_-6px_rgba(255,106,50,0.55)]"
              initial={reduce ? false : { scale: 0.4, rotate: -20 }}
              animate={{ scale: 1, rotate: 0 }}
              transition={{ type: "spring", stiffness: 260, damping: 14, delay: 0.1 }}
            >
              <span aria-hidden className="text-[34px] leading-none">
                {badge}
              </span>
            </motion.div>

            <p className="lux-serif dash-brand relative mt-4 text-[13px] font-bold uppercase tracking-[0.3em] text-[#ffb08a]">
              MISTERDOU<span className="text-[#ff6a32]">.</span>
            </p>
            <h2 id="greeting-title" className="relative mt-2 text-[25px] font-semibold leading-tight text-white">
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
