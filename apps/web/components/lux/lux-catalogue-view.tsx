import Link from "next/link";
import { LuxPerfLed, LuxProvider } from "@/components/lux/lux-data";
import { LuxNav } from "@/components/lux/lux-nav";
import { LuxFooter } from "@/components/lux/lux-footer";
import { ProductCard } from "@/components/lux/lux-product-card";
import { SectionLabel } from "@/components/lux/lux-fx";
import { fetchCatalogueServer, type CatalogueSort } from "@/lib/lux-catalogue";
import { serverApiFetch } from "@/lib/server-api";
import { formatInt, type LuxPaymentMode } from "@/lib/lux";
import { IconArrowLeft, IconArrowRight, IconSearch, IconX } from "@/components/lux/lux-icons";
import { CatalogueTools } from "@/components/lux/lux-catalogue-tools";
import { getServerT } from "@/lib/i18n-server";
import type { MessageKey } from "@/lib/i18n-core";

// ---------------------------------------------------------------
// Socle commun à /offres et /pret-ou-prestation.
//
// Une seule implémentation de la grille, des filtres et de la pagination : les
// deux pages ne diffèrent que par le filtre `paymentMode` et par leur texte.
// Deux pages dupliquées divergeraient (une grille, deux contenus de prix), et
// l'offre à tranches affichée à 0 FCFA d'apport sur l'une et pas sur l'autre
// serait le premier bug signalé par un client.
// ---------------------------------------------------------------

const SORTS: { value: CatalogueSort; label: MessageKey }[] = [
  { value: "newest", label: "cat.sortNewest" },
  { value: "priceAsc", label: "cat.sortPriceAsc" },
  { value: "priceDesc", label: "cat.sortPriceDesc" },
  { value: "power", label: "cat.sortPower" },
  { value: "powerAsc", label: "cat.sortPowerAsc" },
];

export interface CatalogueViewProps {
  searchParams: Promise<{ q?: string; division?: string; sort?: string; page?: string }>;
  /** Racine des liens de filtre : la page doit rester elle-même. */
  basePath: string;
  /** ONE_TIME = tout le catalogue, INSTALLMENTS = offres à mensualités. */
  paymentMode: LuxPaymentMode;
  kicker: string;
  title: React.ReactNode;
  intro: React.ReactNode;
  emptyText: string;
  /** Bloc d'explication propre à la page, affiché sous la liste (pas avant les comptes). */
  aside?: React.ReactNode;
}

// Les deux pages du catalogue, présentées comme deux onglets d'une même boutique.
const MODES: { mode: LuxPaymentMode; href: string; label: MessageKey }[] = [
  { mode: "ONE_TIME", href: "/offres", label: "cat.modeCash" },
  { mode: "INSTALLMENTS", href: "/pret-ou-prestation", label: "cat.modeMonthly" },
];

function href(
  basePath: string,
  base: { division?: string | null; sort?: CatalogueSort; page?: number },
  division: string | null,
  sort: CatalogueSort,
  page: number,
  search: string | null = null,
): string {
  const p = new URLSearchParams();
  if (search) p.set("q", search);
  const d = base.division !== undefined ? base.division : division;
  if (d) p.set("division", d);
  const s = base.sort ?? sort;
  if (s !== "newest") p.set("sort", s);
  const pg = base.page ?? page;
  if (pg > 1) p.set("page", String(pg));
  const q = p.toString();
  return q ? `${basePath}?${q}` : basePath;
}

function ActiveFilter({ label, href: to, removeLabel }: { label: string; href: string; removeLabel: string }) {
  return (
    <Link
      href={to}
      aria-label={`${removeLabel} : ${label}`}
      className="inline-flex items-center gap-1.5 rounded-full border border-[rgba(255,106,50,0.35)] bg-[rgba(232,71,36,0.1)] py-1.5 pl-3 pr-2 text-stone-200 hover:border-[rgba(255,106,50,0.7)]"
    >
      {label}
      <IconX className="h-3.5 w-3.5 text-stone-400" aria-hidden />
    </Link>
  );
}

export function CatalogueView({
  searchParams,
  basePath,
  paymentMode,
  kicker,
  title,
  intro,
  emptyText,
  aside,
}: CatalogueViewProps) {
  return (
    <LuxProvider>
      <CatalogueBody
        searchParams={searchParams}
        basePath={basePath}
        paymentMode={paymentMode}
        kicker={kicker}
        title={title}
        intro={intro}
        emptyText={emptyText}
        aside={aside}
      />
    </LuxProvider>
  );
}

async function CatalogueBody({
  searchParams,
  basePath,
  paymentMode,
  kicker,
  title,
  intro,
  emptyText,
  aside,
}: CatalogueViewProps) {
  const t = await getServerT();
  const sp = await searchParams;
  const division = sp.division && sp.division !== "all" ? sp.division : null;
  const sort: CatalogueSort =
    sp.sort && SORTS.some((s) => s.value === sp.sort) ? (sp.sort as CatalogueSort) : "newest";
  const page = Math.max(1, Number.parseInt(sp.page ?? "1", 10) || 1);
  const search = sp.q?.trim().slice(0, 60) || null;
  const minPower = search && /^\d[\d\s.]*$/.test(search) ? search.replace(/\D/g, "") : null;

  let data: Awaited<ReturnType<typeof fetchCatalogueServer>> | null = null;
  let error: string | null = null;
  try {
    data = await fetchCatalogueServer(serverApiFetch, {
      division: division ?? undefined,
      sort,
      q: search ?? undefined,
      page,
      perPage: 12,
      paymentMode,
    });
  } catch {
    error = t("cat.unavailable");
  }

  const meta = data?.meta ?? null;
  const divisions = meta?.divisions ?? [];

  return (
    <div data-lux className="relative min-h-screen overflow-x-clip text-stone-100">
      <div className="lux-bg" aria-hidden />
      <LuxNav root />
      <main className="relative z-10 px-5 pt-32 md:px-8 md:pt-40">
        <div className="mx-auto max-w-6xl">
          <SectionLabel>{kicker}</SectionLabel>
          <div className="mt-5 flex flex-wrap items-end justify-between gap-4">
            <h1 className="lux-h2 text-stone-100">{title}</h1>
            {meta && (
              <span className="text-[11px] uppercase tracking-[0.24em] text-stone-400">
                {t(meta.total > 1 ? "cat.countMany" : "cat.countOne", { count: formatInt(meta.total) })}
              </span>
            )}
          </div>
          <div className="mt-4 max-w-2xl text-[14px] leading-relaxed text-stone-400">
            {intro}
            <Link href="/comment-ca-marche" className="mt-2 inline-block text-[13px] text-[var(--lux-gold-light)] hover:underline">
              {t("cat.howLink")}
            </Link>
          </div>

          {/* Comptant / Mensualités : deux onglets d'une même boutique. */}
          <nav aria-label={t("cat.modeLabel")} className="mt-7 inline-flex rounded-full border border-white/10 bg-white/[0.03] p-1">
            {MODES.map((m) => (
              <Link
                key={m.mode}
                href={m.href}
                aria-current={m.mode === paymentMode ? "page" : undefined}
                className={`rounded-full px-5 py-2 text-[13px] font-medium transition-colors ${
                  m.mode === paymentMode
                    ? "bg-[linear-gradient(135deg,#ff8a5c,#e84724)] text-[#1a0a06] shadow-[0_6px_20px_-8px_rgba(232,71,36,0.8)]"
                    : "text-stone-300 hover:text-white"
                }`}
              >
                {t(m.label)}
              </Link>
            ))}
          </nav>

          {/* Recherche + « Trier et filtrer » sur une seule ligne. La recherche
              est un formulaire classique : elle marche même sans JavaScript. */}
          <div className="mt-5 flex max-w-2xl items-center gap-2">
            <form action={basePath} method="get" role="search" className="relative min-w-0 flex-1">
              {division && <input type="hidden" name="division" value={division} />}
              {sort !== "newest" && <input type="hidden" name="sort" value={sort} />}
              <label className="sr-only" htmlFor="catalogue-search">
                {t("cat.searchLabel")}
              </label>
              <IconSearch className="pointer-events-none absolute left-4 top-1/2 z-10 h-[18px] w-[18px] -translate-y-1/2 text-stone-500" aria-hidden />
              <input
                id="catalogue-search"
                type="search"
                name="q"
                defaultValue={search ?? ""}
                maxLength={60}
                enterKeyHint="search"
                placeholder={t("cat.searchPlaceholder")}
                className="lux-glass h-[48px] w-full rounded-full border border-white/10 bg-transparent pl-11 pr-12 text-[14px] text-stone-100 outline-none placeholder:text-stone-500 focus:border-[rgba(255,106,50,0.6)]"
              />
              <button
                type="submit"
                aria-label={t("cat.searchButton")}
                className="absolute right-1.5 top-1/2 grid h-9 w-9 -translate-y-1/2 place-items-center rounded-full bg-[linear-gradient(135deg,#ff8a5c,#e84724)] text-[#1a0a06]"
              >
                <IconArrowRight className="h-4 w-4" aria-hidden />
              </button>
            </form>
            <CatalogueTools
              label={t("cat.tools")}
              sortTitle={t("cat.sortBy")}
              divisionTitle={t("cat.divisionTitle")}
              closeLabel={t("chat.close")}
              changed={sort !== "newest" || division !== null}
              sorts={SORTS.map((s) => ({
                label: t(s.label),
                href: href(basePath, { sort: s.value }, division, sort, 1, search),
                active: sort === s.value,
              }))}
              divisions={[
                { label: t("cat.all"), href: href(basePath, { division: null }, division, sort, 1, search), active: division === null },
                ...divisions.map((d) => ({ label: d, href: href(basePath, { division: d }, division, sort, 1, search), active: division === d })),
              ]}
            />
          </div>

          {/* Filtres actifs : visibles et retirables d'un geste. */}
          {(search || division || sort !== "newest") && (
            <div className="mt-3 flex flex-wrap items-center gap-2 text-[12.5px]">
              {search && (
                <ActiveFilter
                  label={minPower ? t("cat.searchPower", { power: formatInt(Number(minPower)) }) : t("cat.searchName", { q: search })}
                  href={href(basePath, { page: 1 }, division, sort, 1)}
                  removeLabel={t("cat.searchClear")}
                />
              )}
              {division && (
                <ActiveFilter label={division} href={href(basePath, { division: null }, division, sort, 1, search)} removeLabel={t("cat.removeFilter")} />
              )}
              {sort !== "newest" && (
                <ActiveFilter
                  label={t(SORTS.find((s) => s.value === sort)!.label)}
                  href={href(basePath, { sort: "newest" }, division, sort, 1, search)}
                  removeLabel={t("cat.removeFilter")}
                />
              )}
            </div>
          )}

          {error ? (
            <div className="mt-10 rounded-[24px] border border-white/10 bg-[rgba(23,20,18,0.7)] p-10 text-center">
              <p className="text-[14px] text-stone-400">{error}</p>
              <Link href={basePath} className="lux-btn lux-btn-gold mt-6">
                {t("product.retry")}
              </Link>
            </div>
          ) : data && data.items.length > 0 ? (
            <>
              <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
                {data.items.map((p, i) => (
                  <ProductCard key={p.id} product={p} index={i} animateIn={false} installments={paymentMode === "INSTALLMENTS"} />
                ))}
              </div>

              {meta && meta.totalPages > 1 && (
                <nav aria-label={t("cat.pagination")} className="mt-12 flex items-center justify-center gap-4">
                  <Link
                    href={href(basePath, { page: page - 1 }, division, sort, page, search)}
                    aria-disabled={page <= 1}
                    className={
                      page <= 1
                        ? "lux-btn lux-btn-ghost pointer-events-none px-5 opacity-35"
                        : "lux-btn lux-btn-ghost px-5"
                    }
                  >
                    <IconArrowLeft className="h-4 w-4" aria-hidden />
                    {t("cat.previous")}
                  </Link>
                  <span className="text-[12px] tabular-nums tracking-[0.14em] text-stone-400">
                    {t("cat.page", { page: meta.page, total: meta.totalPages })}
                  </span>
                  <Link
                    href={href(basePath, { page: page + 1 }, division, sort, page, search)}
                    aria-disabled={page >= meta.totalPages}
                    className={
                      page >= meta.totalPages
                        ? "lux-btn lux-btn-ghost pointer-events-none px-5 opacity-35"
                        : "lux-btn lux-btn-ghost px-5"
                    }
                  >
                    {t("cat.next")}
<IconArrowRight className="h-4 w-4" aria-hidden />
                  </Link>
                </nav>
              )}
            </>
          ) : (
            <div className="mt-10 rounded-[24px] border border-white/10 bg-[rgba(23,20,18,0.7)] p-10 text-center">
              <p className="text-[14px] text-stone-400">{emptyText}</p>
              <Link href={basePath} className="lux-btn lux-btn-ghost mt-6">
                {t("cat.showAll")}
              </Link>
            </div>
          )}

          {aside}
        </div>
      </main>
      <div className="mt-8">
        <LuxFooter />
      </div>
      <LuxPerfLed />
    </div>
  );
}
