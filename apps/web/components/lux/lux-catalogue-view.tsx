import Link from "next/link";
import { LuxPerfLed, LuxProvider } from "@/components/lux/lux-data";
import { LuxNav } from "@/components/lux/lux-nav";
import { LuxFooter } from "@/components/lux/lux-footer";
import { ProductCard } from "@/components/lux/lux-product-card";
import { SectionLabel } from "@/components/lux/lux-fx";
import { fetchCatalogueServer, type CatalogueSort } from "@/lib/lux-catalogue";
import { formatInt, type LuxPaymentMode } from "@/lib/lux";
import { IconArrowLeft, IconArrowRight } from "@/components/lux/lux-icons";

// ---------------------------------------------------------------
// Socle commun à /offres et /pret-ou-prestation.
//
// Une seule implémentation de la grille, des filtres et de la pagination : les
// deux pages ne diffèrent que par le filtre `paymentMode` et par leur texte.
// Deux pages dupliquées divergeraient (une grille, deux contenus de prix), et
// l'offre à tranches affichée à 0 FCFA d'apport sur l'une et pas sur l'autre
// serait le premier bug signalé par un client.
// ---------------------------------------------------------------

const SORTS: { value: CatalogueSort; label: string }[] = [
  { value: "newest", label: "Nouveautés" },
  { value: "priceAsc", label: "Prix croissant" },
  { value: "priceDesc", label: "Prix décroissant" },
  { value: "power", label: "Puissance" },
];

export interface CatalogueViewProps {
  searchParams: Promise<{ division?: string; sort?: string; page?: string }>;
  /** Racine des liens de filtre : la page doit rester elle-même. */
  basePath: string;
  /** ONE_TIME = tout le catalogue, INSTALLMENTS = offres à mensualités. */
  paymentMode: LuxPaymentMode;
  kicker: string;
  title: React.ReactNode;
  intro: React.ReactNode;
  emptyText: string;
  /** Bloc d'explication propre à la page (échéancier, garantie…). */
  aside?: React.ReactNode;
}

function href(
  basePath: string,
  base: { division?: string | null; sort?: CatalogueSort; page?: number },
  division: string | null,
  sort: CatalogueSort,
  page: number,
): string {
  const p = new URLSearchParams();
  const d = base.division !== undefined ? base.division : division;
  if (d) p.set("division", d);
  const s = base.sort ?? sort;
  if (s !== "newest") p.set("sort", s);
  const pg = base.page ?? page;
  if (pg > 1) p.set("page", String(pg));
  const q = p.toString();
  return q ? `${basePath}?${q}` : basePath;
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
  const sp = await searchParams;
  const division = sp.division && sp.division !== "all" ? sp.division : null;
  const sort: CatalogueSort =
    sp.sort && SORTS.some((s) => s.value === sp.sort) ? (sp.sort as CatalogueSort) : "newest";
  const page = Math.max(1, Number.parseInt(sp.page ?? "1", 10) || 1);

  let data: Awaited<ReturnType<typeof fetchCatalogueServer>> | null = null;
  let error: string | null = null;
  try {
    data = await fetchCatalogueServer({
      division: division ?? undefined,
      sort,
      page,
      perPage: 12,
      paymentMode,
    });
  } catch {
    error = "Le catalogue est momentanément indisponible.";
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
                {formatInt(meta.total)} compte{meta.total > 1 ? "s" : ""}
              </span>
            )}
          </div>
          <div className="mt-4 max-w-2xl text-[14px] leading-relaxed text-stone-400">{intro}</div>

          {aside}

          <div className="mt-10 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div className="flex flex-wrap gap-2" role="group" aria-label="Filtrer par division">
              <Link
                href={href(basePath, { division: null }, division, sort, 1)}
                aria-current={division === null ? "page" : undefined}
                className={
                  division === null
                    ? "lux-glass-chip lux-chip-active"
                    : "lux-glass-chip hover:border-[rgba(255,106,50,0.5)]"
                }
              >
                Toutes
              </Link>
              {divisions.map((d) => (
                <Link
                  key={d}
                  href={href(basePath, { division: d }, division, sort, 1)}
                  aria-current={division === d ? "page" : undefined}
                  className={
                    division === d
                      ? "lux-glass-chip lux-chip-active"
                      : "lux-glass-chip hover:border-[rgba(255,106,50,0.5)]"
                  }
                >
                  {d}
                </Link>
              ))}
            </div>

            <div className="flex flex-wrap gap-2" role="group" aria-label="Trier le catalogue">
              {SORTS.map((s) => (
                <Link
                  key={s.value}
                  href={href(basePath, { sort: s.value }, division, sort, 1)}
                  aria-current={sort === s.value ? "page" : undefined}
                  className={
                    sort === s.value
                      ? "lux-glass-chip lux-chip-active"
                      : "lux-glass-chip hover:border-[rgba(255,106,50,0.5)]"
                  }
                >
                  {s.label}
                </Link>
              ))}
            </div>
          </div>

          {error ? (
            <div className="mt-10 rounded-[24px] border border-white/10 bg-[rgba(23,20,18,0.7)] p-10 text-center">
              <p className="text-[14px] text-stone-400">{error}</p>
              <Link href={basePath} className="lux-btn lux-btn-gold mt-6">
                Réessayer
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
                <nav aria-label="Pagination" className="mt-12 flex items-center justify-center gap-4">
                  <Link
                    href={href(basePath, { page: page - 1 }, division, sort, page)}
                    aria-disabled={page <= 1}
                    className={
                      page <= 1
                        ? "lux-btn lux-btn-ghost pointer-events-none px-5 opacity-35"
                        : "lux-btn lux-btn-ghost px-5"
                    }
                  >
                    <IconArrowLeft className="h-4 w-4" aria-hidden />
                    Précédent
                  </Link>
                  <span className="text-[12px] tabular-nums tracking-[0.14em] text-stone-400">
                    Page {meta.page} / {meta.totalPages}
                  </span>
                  <Link
                    href={href(basePath, { page: page + 1 }, division, sort, page)}
                    aria-disabled={page >= meta.totalPages}
                    className={
                      page >= meta.totalPages
                        ? "lux-btn lux-btn-ghost pointer-events-none px-5 opacity-35"
                        : "lux-btn lux-btn-ghost px-5"
                    }
                  >
                    Suivant
                    <IconArrowRight className="h-4 w-4" aria-hidden />
                  </Link>
                </nav>
              )}
            </>
          ) : (
            <div className="mt-10 rounded-[24px] border border-white/10 bg-[rgba(23,20,18,0.7)] p-10 text-center">
              <p className="text-[14px] text-stone-400">{emptyText}</p>
              <Link href={basePath} className="lux-btn lux-btn-ghost mt-6">
                Tout afficher
              </Link>
            </div>
          )}
        </div>
      </main>
      <div className="mt-8">
        <LuxFooter />
      </div>
      <LuxPerfLed />
    </div>
  );
}
