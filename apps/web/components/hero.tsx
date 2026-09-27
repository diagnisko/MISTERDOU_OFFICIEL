import Link from "next/link";
import type { PublicMeta } from "@misterdou/shared";
import { formatXof } from "@/lib/api";
import { FadeIn } from "./motion-fade";

export function Hero({ meta }: { meta: PublicMeta | null }) {
  return (
    <section className="relative overflow-hidden">
      <div
        aria-hidden
        className="pointer-events-none absolute -top-40 left-1/2 h-[520px] w-[820px] -translate-x-1/2 rounded-full opacity-40 blur-3xl"
        style={{
          background:
            "radial-gradient(closest-side, rgb(245 158 11 / 0.35), rgb(139 92 246 / 0.12), transparent)",
        }}
      />
      <div className="relative mx-auto max-w-6xl px-4 pb-20 pt-16 text-center md:pt-24">
        <FadeIn>
          <span className="glass inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-medium text-muted">
            <span className="h-2 w-2 rounded-full bg-accent" />
            Identité vérifiée · Paiement Wave / Orange Money sécurisé
          </span>
        </FadeIn>

        <FadeIn delay={0.08}>
          <h1 className="mx-auto mt-6 max-w-3xl text-balance text-4xl font-black leading-tight tracking-tight md:text-6xl">
            Des comptes <span className="gradient-text">eFootball</span> premium, prêts à rejoindre votre équipe.
          </h1>
        </FadeIn>

        <FadeIn delay={0.16}>
          <p className="mx-auto mt-5 max-w-xl text-pretty text-base text-muted md:text-lg">
            Catalogue vérifié, livraison sécurisée des identifiants, paiement en une fois ou
            en plusieurs fois. Chaque transaction est contrôlée côté serveur.
          </p>
        </FadeIn>

        <FadeIn delay={0.24}>
          <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Link
              href="/catalogue"
              className="shadow-glow w-full rounded-full bg-brand px-7 py-3 text-sm font-semibold text-background transition-transform hover:scale-[1.03] sm:w-auto"
            >
              Parcourir le catalogue
            </Link>
          </div>
        </FadeIn>

        {meta && (
          <FadeIn delay={0.32}>
            <dl className="glass mx-auto mt-10 grid max-w-2xl grid-cols-2 gap-px overflow-hidden rounded-2xl text-left sm:grid-cols-4">
              <MetaStat label="Paiement échelonné" value={`${meta.maxInstallments} mois`} note="maximum" />
            </dl>
            <p className="mt-3 text-xs text-muted">
              Tarifs et règles recalculés depuis la plateforme (jamais d&apos;affichage figé).
            </p>
          </FadeIn>
        )}
      </div>
    </section>
  );
}

function MetaStat({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="bg-surface/60 px-4 py-4">
      <dt className="text-xs uppercase tracking-wide text-muted">{label}</dt>
      <dd className="mt-1 text-lg font-bold text-foreground">{value}</dd>
      {note && <dd className="text-xs text-muted">{note}</dd>}
    </div>
  );
}