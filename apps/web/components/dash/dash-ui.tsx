"use client";

import { useEffect, useMemo, useRef, useState, type ComponentType, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { IconClose, IconLogout, IconMenu, IconSearch } from "./dash-icons";
import { NotificationBell } from "@/components/notifications/notification-bell";
import { MessagesButton } from "@/components/chat/messages-button";
import { BackButton } from "@/components/back-button";
import { AccountMenu } from "@/components/account/account-menu";
import { useT } from "@/lib/i18n";

// ---------------------------------------------------------------------------
// Kit des tableaux de bord (admin + vendeur).
// ---------------------------------------------------------------------------

export type DashNavItem = {
  href: string;
  label: string;
  icon: ComponentType<{ className?: string; size?: number }>;
  group?: string;
};

/** Recherche rapide : filtre la navigation, Entrée ouvre le premier résultat. */
function QuickJump({ items, autoFocus = false, onDone }: { items: DashNavItem[]; autoFocus?: boolean; onDone?: () => void }) {
  const t = useT();
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return items.filter((item) => item.label.toLowerCase().includes(q)).slice(0, 6);
  }, [items, query]);

  function go(href: string) {
    setQuery("");
    setOpen(false);
    onDone?.();
    router.push(href);
  }

  return (
    <div className="relative w-full md:max-w-sm">
      <IconSearch className="pointer-events-none absolute left-3.5 top-1/2 z-10 -translate-y-1/2 text-[#8a7771]" size={16} />
      <input
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && matches[0]) go(matches[0].href);
          if (event.key === "Escape") {
            setOpen(false);
            onDone?.();
          }
        }}
        autoFocus={autoFocus}
        placeholder={t("dash.search")}
        aria-label={t("dash.searchLabel")}
        className="dash-input"
      />
      {open && matches.length > 0 && (
        <ul className="dash-card absolute left-0 right-0 top-[calc(100%+6px)] z-50 overflow-hidden p-1.5">
          {matches.map((item) => (
            <li key={item.href}>
              <button
                type="button"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => go(item.href)}
                className="dash-nav-link w-full"
              >
                <item.icon size={16} />
                {item.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function DashShell({
  nav,
  areaLabel,
  user,
  badge,
  onLogout,
  loggingOut,
  children,
}: {
  nav: DashNavItem[];
  areaLabel: string;
  user: { name: string; email?: string | null };
  badge?: ReactNode;
  onLogout: () => void;
  loggingOut?: boolean;
  children: ReactNode;
}) {
  const t = useT();
  const pathname = usePathname();
  const [drawer, setDrawer] = useState(false);
  // Téléphone : la recherche s'ouvre sur toute la largeur, sous la barre.
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    setDrawer(false);
    setSearching(false);
  }, [pathname]);

  const isActive = (href: string) => {
    const root = nav[0]?.href;
    return href === root ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
  };

  const groups = nav.reduce<Array<{ name: string; items: DashNavItem[] }>>((acc, item) => {
    const name = item.group ?? "";
    const last = acc[acc.length - 1];
    if (last && last.name === name) last.items.push(item);
    else acc.push({ name, items: [item] });
    return acc;
  }, []);

  const sidebar = (
    <div className="flex h-full flex-col">
      <Link href="/" className="lux-serif dash-brand px-2 text-[22px] font-bold text-stone-50">
        MISTERDOU<span className="text-[#ff6a32]">.</span>
      </Link>
      <p className="mt-1 px-2 text-[11px] text-[#8f7d77]">{areaLabel}</p>

      <nav aria-label={areaLabel} className="mt-7 flex-1 space-y-5 overflow-y-auto pr-1">
        {groups.map((group) => (
          <div key={group.name || "main"}>
            {group.name && <p className="mb-1.5 px-3 text-[11px] text-[#6f5f5a]">{group.name}</p>}
            <ul className="space-y-0.5">
              {group.items.map((item) => (
                <li key={item.href}>
                  <Link href={item.href} aria-current={isActive(item.href) ? "page" : undefined} className="dash-nav-link">
                    <item.icon size={17} />
                    {item.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>

      <button type="button" onClick={onLogout} disabled={loggingOut} className="dash-nav-link mt-4 w-full disabled:opacity-60">
        <IconLogout size={17} />
        {loggingOut ? t("dash.loggingOut") : t("dash.logout")}
      </button>
    </div>
  );

  return (
    <div data-lux className="dash-root">
      <div className="lg:grid lg:grid-cols-[248px_minmax(0,1fr)]">
        <aside className="hidden border-r border-[rgba(255,236,229,0.06)] px-4 py-6 lg:sticky lg:top-0 lg:block lg:h-screen">
          {sidebar}
        </aside>

        {drawer && (
          <div className="fixed inset-0 z-[80] lg:hidden" role="dialog" aria-modal="true" aria-label={t("dash.nav")}>
            <button type="button" aria-label={t("dash.closeMenu")} className="absolute inset-0 bg-black/70" onClick={() => setDrawer(false)} />
            <aside className="dash-frame absolute inset-y-0 left-0 w-[280px] px-4 py-6">
              <button type="button" onClick={() => setDrawer(false)} aria-label={t("dash.closeMenu")} className="dash-btn dash-btn-ghost dash-btn-round absolute right-3 top-4 !min-h-[36px] !w-[36px]">
                <IconClose size={16} />
              </button>
              {sidebar}
            </aside>
          </div>
        )}

        <div className="min-w-0">
          <header className="sticky top-0 z-40 border-b border-[rgba(255,236,229,0.06)] bg-[#050303]/80 backdrop-blur-xl">
            <div className="flex items-center gap-2 px-4 py-3 sm:gap-3 sm:px-6 lg:px-8">
              <button type="button" onClick={() => setDrawer(true)} aria-label={t("dash.openMenu")} className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-[rgba(255,255,255,0.1)] bg-white/[0.03] text-stone-300 transition-colors hover:border-[rgba(232,71,36,0.45)] hover:text-[var(--lux-gold)] lg:hidden">
                <IconMenu size={18} />
              </button>
              <BackButton hideOn={["/admin", "/seller"]} />
              <div className="hidden min-w-0 flex-1 md:block">
                <QuickJump items={nav} />
              </div>
              <div className="ml-auto flex shrink-0 items-center gap-2 sm:gap-3">
                {badge}
                <button
                  type="button"
                  onClick={() => setSearching((v) => !v)}
                  aria-expanded={searching}
                  aria-label={t("dash.searchLabel")}
                  className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-[rgba(255,255,255,0.1)] bg-white/[0.03] text-stone-300 transition-colors hover:border-[rgba(232,71,36,0.45)] hover:text-[var(--lux-gold)] md:hidden"
                >
                  {searching ? <IconClose size={16} /> : <IconSearch size={17} />}
                </button>
                <MessagesButton inConsole />
                <NotificationBell />
                {/* Jamais « Connexion / Créer un compte » dans un espace connecté. */}
                <AccountMenu compact />
              </div>
            </div>
            {searching && (
              <div className="px-4 pb-3 md:hidden">
                <QuickJump items={nav} autoFocus onDone={() => setSearching(false)} />
              </div>
            )}
          </header>

          <main className="px-4 pb-14 pt-7 sm:px-6 lg:px-8">{children}</main>
        </div>
      </div>
    </div>
  );
}

export function DashHeading({ greeting, title, actions }: { greeting?: string; title: string; actions?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div>
        {greeting && <p className="text-[14px] text-[#b8a6a1]">{greeting}</p>}
        <h1 className="mt-1 text-[28px] font-semibold leading-tight tracking-[-0.01em] text-stone-50 sm:text-[34px]">{title}</h1>
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function KpiCard({
  label,
  value,
  icon: Icon,
  hero = false,
  delta,
  hint,
  href,
  loading = false,
}: {
  label: string;
  value: string;
  icon: ComponentType<{ className?: string; size?: number }>;
  hero?: boolean;
  delta?: { value: string; positive: boolean } | null;
  hint?: string;
  href?: string;
  loading?: boolean;
}) {
  const body = (
    <>
      {/* Téléphone : cartes compactes (2 par ligne), l'icône décorative disparaît. */}
      <span className="dash-icon !hidden sm:!inline-grid">
        <Icon size={18} />
      </span>
      <p className={`text-[12px] leading-snug sm:mt-6 sm:text-[13px] ${hero ? "text-white/85" : "text-[#b8a6a1]"}`}>{label}</p>
      <div className="mt-1.5 flex flex-wrap items-center gap-2.5">
        {loading ? (
          <span className="lux-skeleton inline-block h-8 w-32" style={{ borderRadius: 8 }} aria-label="Chargement" />
        ) : (
          <span className="text-[19px] font-semibold tabular-nums tracking-[-0.01em] text-white sm:text-[26px]">{value}</span>
        )}
        {delta && !loading && (
          <span className={`dash-delta ${hero ? "border-white/40 text-white" : delta.positive ? "text-[#86efac]" : "text-[#fca5a5]"}`}>
            {delta.value}
          </span>
        )}
      </div>
      {hint && <p className={`mt-1.5 text-[11px] leading-snug sm:mt-2 sm:text-[12px] ${hero ? "text-white/70" : "text-[#8f7d77]"}`}>{hint}</p>}
    </>
  );
  const cls = `dash-card ${hero ? "dash-card-hero" : ""} block p-4 sm:p-5`;
  return href ? (
    <Link href={href} className={cls}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}

export function Panel({
  title,
  action,
  children,
  className = "",
}: {
  title: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`dash-card min-w-0 p-5 ${className}`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-[15px] font-semibold text-stone-100">{title}</h2>
        {action}
      </div>
      <div className="mt-4">{children}</div>
    </section>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: Array<{ value: T; label: string; count?: number }>;
  onChange: (value: T) => void;
  label: string;
}) {
  return (
    <div role="tablist" aria-label={label} className="flex flex-wrap gap-1 rounded-full border border-[rgba(255,236,229,0.08)] bg-white/[0.02] p-1">
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(option.value)}
            className={`rounded-full px-3 py-1.5 text-[12px] font-medium transition ${
              active ? "bg-[linear-gradient(120deg,#c83a24,#8e2014)] text-white" : "text-[#b8a6a1] hover:text-white"
            }`}
          >
            {option.label}
            {option.count !== undefined && <span className={`ml-1.5 tabular-nums ${active ? "text-white/80" : "text-[#8f7d77]"}`}>{option.count}</span>}
          </button>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Graphique en aires (SVG maison, interactif au survol / au doigt)
// ---------------------------------------------------------------------------

type Point = { label: string; primary: number; secondary?: number };

function smoothPath(points: Array<[number, number]>) {
  if (points.length === 0) return "";
  let d = `M${points[0]![0]},${points[0]![1]}`;
  for (let i = 1; i < points.length; i++) {
    const [x0, y0] = points[i - 1]!;
    const [x1, y1] = points[i]!;
    const cx = (x0 + x1) / 2;
    d += ` C${cx},${y0} ${cx},${y1} ${x1},${y1}`;
  }
  return d;
}

export function AreaChart({
  data,
  primaryLabel,
  secondaryLabel,
  format,
  height = 240,
}: {
  data: Point[];
  primaryLabel: string;
  secondaryLabel?: string;
  format: (value: number) => string;
  height?: number;
}) {
  const ref = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const W = 720;
  const H = height;
  const pad = { top: 16, right: 12, bottom: 28, left: 12 };
  const max = Math.max(1, ...data.flatMap((d) => [d.primary, d.secondary ?? 0])) * 1.12;
  const step = data.length > 1 ? (W - pad.left - pad.right) / (data.length - 1) : 0;
  const x = (i: number) => pad.left + i * step;
  const y = (v: number) => pad.top + (1 - v / max) * (H - pad.top - pad.bottom);

  const primary = data.map((d, i) => [x(i), y(d.primary)] as [number, number]);
  const secondary = secondaryLabel ? data.map((d, i) => [x(i), y(d.secondary ?? 0)] as [number, number]) : [];
  const line = smoothPath(primary);
  const area = `${line} L${x(data.length - 1)},${H - pad.bottom} L${x(0)},${H - pad.bottom} Z`;
  const grid = [0.25, 0.5, 0.75, 1].map((f) => pad.top + (1 - f) * (H - pad.top - pad.bottom));

  function onMove(clientX: number) {
    const svg = ref.current;
    if (!svg || data.length === 0) return;
    const rect = svg.getBoundingClientRect();
    const px = ((clientX - rect.left) / rect.width) * W;
    const i = Math.round((px - pad.left) / (step || 1));
    setHover(Math.max(0, Math.min(data.length - 1, i)));
  }

  const h = hover !== null ? data[hover] : null;
  const tipLeft = hover !== null ? (x(hover) / W) * 100 : 0;

  return (
    <div className="relative">
      <svg
        ref={ref}
        viewBox={`0 0 ${W} ${H}`}
        className="block h-auto w-full touch-none select-none"
        role="img"
        aria-label={`${primaryLabel} sur ${data.length} mois`}
        onPointerMove={(event) => onMove(event.clientX)}
        onPointerDown={(event) => onMove(event.clientX)}
        onPointerLeave={() => setHover(null)}
      >
        <defs>
          <linearGradient id="dash-area" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#e84724" stopOpacity="0.55" />
            <stop offset="100%" stopColor="#7a1712" stopOpacity="0.02" />
          </linearGradient>
          <radialGradient id="dash-dot">
            <stop offset="0%" stopColor="#fff" />
            <stop offset="60%" stopColor="#ffd9c2" stopOpacity="0.6" />
            <stop offset="100%" stopColor="#ff6a32" stopOpacity="0" />
          </radialGradient>
        </defs>
        {grid.map((gy) => (
          <line key={gy} x1={pad.left} x2={W - pad.right} y1={gy} y2={gy} stroke="rgba(255,236,229,0.07)" />
        ))}
        <path d={area} fill="url(#dash-area)" />
        <path d={line} fill="none" stroke="#ff6a32" strokeWidth="2" />
        {secondary.length > 0 && <path d={smoothPath(secondary)} fill="none" stroke="rgba(255,236,229,0.55)" strokeWidth="1.2" strokeDasharray="1 0" />}
        {data.map((d, i) => (
          <text key={d.label} x={x(i)} y={H - 8} textAnchor="middle" fontSize="11" fill="#8f7d77">
            {d.label}
          </text>
        ))}
        {hover !== null && h && (
          <g>
            <line x1={x(hover)} x2={x(hover)} y1={pad.top} y2={H - pad.bottom} stroke="rgba(255,236,229,0.5)" strokeDasharray="4 4" />
            <circle cx={x(hover)} cy={y(h.primary)} r="14" fill="url(#dash-dot)" />
            <circle cx={x(hover)} cy={y(h.primary)} r="3.5" fill="#fff" />
          </g>
        )}
      </svg>

      {hover !== null && h && (
        <div
          className="dash-card pointer-events-none absolute top-2 z-10 min-w-[170px] -translate-x-1/2 px-3.5 py-2.5 text-[12px]"
          style={{ left: `${Math.min(84, Math.max(16, tipLeft))}%` }}
          role="status"
        >
          <p className="text-[11px] text-[#8f7d77]">{h.label}</p>
          <div className="mt-1.5 flex gap-4">
            <div className="border-l-2 border-[#ff6a32] pl-2">
              <p className="text-[11px] text-[#b8a6a1]">{primaryLabel}</p>
              <p className="font-semibold tabular-nums text-white">{format(h.primary)}</p>
            </div>
            {secondaryLabel && (
              <div className="border-l-2 border-[rgba(255,236,229,0.55)] pl-2">
                <p className="text-[11px] text-[#b8a6a1]">{secondaryLabel}</p>
                <p className="font-semibold tabular-nums text-white">{format(h.secondary ?? 0)}</p>
              </div>
            )}
          </div>
        </div>
      )}

      <div className="mt-2 flex flex-wrap gap-4 text-[12px] text-[#b8a6a1]">
        <span className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-[#ff6a32]" /> {primaryLabel}
        </span>
        {secondaryLabel && (
          <span className="flex items-center gap-2">
            <span className="h-px w-3 bg-[rgba(255,236,229,0.7)]" /> {secondaryLabel}
          </span>
        )}
      </div>
    </div>
  );
}
