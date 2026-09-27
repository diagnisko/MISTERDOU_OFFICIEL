import { FadeIn } from "./motion-fade";
import { Signature } from "./icons";

export function TrustSection() {
  const items = [
    {
      title: "Identité vérifiée",
      text: "Acheteurs et vendeurs passent une vérification d'identité. Vos pièces d'identité et selfies restent privés, jamais accessibles publiquement.",
    },
    {
      title: "Identifiants protégés",
      text: "Les identifiants eFootball sont chiffrés et livrés uniquement après paiement confirmé côté serveur. Jamais exposés dans le catalogue.",
    },
    {
      title: "Paiement sécurisé",
      text: "Tous les paiements se règlent avec Wave ou Orange Money et sont confirmés par vérification serveur — pas par une simple redirection.",
    },
    {
      title: "Commission transparente",
      text: "Chaque vente calcule la commission et le solde vendeur de façon automatique et traçable avec un historique financier complet.",
    },
  ];
  return (
    <section id="securite" className="mx-auto max-w-6xl px-4 py-16">
      <FadeIn>
        <h2 className="text-center text-3xl font-black tracking-tight md:text-4xl">
          Conçu pour la <span className="gradient-text">sécurité</span> et la confiance
        </h2>
        <p className="mx-auto mt-3 max-w-xl text-center text-muted">
          Security-by-design et privacy-by-design : vos données sensibles ne sont jamais
          exposées.
        </p>
      </FadeIn>
      <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {items.map((item) => (
          <FadeIn key={item.title} delay={0.05}>
            <div className="glass card-hover h-full rounded-2xl p-5">
              <h3 className="text-base font-bold text-foreground">{item.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted">{item.text}</p>
            </div>
          </FadeIn>
        ))}
      </div>
    </section>
  );
}

export function HowItWorks() {
  const steps = [
    { n: "01", t: "Créez votre compte", d: "Inscription par téléphone ou Google, puis vérification par code OTP." },
    { n: "02", t: "Vérifiez votre identité", d: "Parcours KYC sécurisé : pièce d'identité et selfie, traités en privé." },
    { n: "03", t: "Achetez ou vendez", d: "Parcourez le catalogue, payez en une fois ou en plusieurs fois avec Wave ou Orange Money." },
    { n: "04", t: "Recevez le compte", d: "Les identifiants chiffrés sont livrés dans votre espace après confirmation." },
  ];
  return (
    <section id="comment" className="border-y border-border bg-surface/40 py-16">
      <div className="mx-auto max-w-6xl px-4">
        <FadeIn>
          <h2 className="text-center text-3xl font-black tracking-tight md:text-4xl">
            Comment ça marche
          </h2>
        </FadeIn>
        <div className="mt-10 grid gap-4 md:grid-cols-4">
          {steps.map((s, i) => (
            <FadeIn key={s.n} delay={i * 0.07}>
              <div className="relative rounded-2xl p-5">
                <span className="text-4xl font-black text-brand/30">{s.n}</span>
                <h3 className="mt-3 font-bold">{s.t}</h3>
                <p className="mt-1 text-sm text-muted">{s.d}</p>
              </div>
            </FadeIn>
          ))}
        </div>
      </div>
    </section>
  );
}

export function ProductPreview() {
  return (
    <section id="catalogue" className="mx-auto max-w-6xl px-4 py-16">
      <FadeIn>
        <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
          <div>
            <h2 className="text-3xl font-black tracking-tight md:text-4xl">Le catalogue arrive bientôt</h2>
            <p className="mt-2 max-w-xl text-muted">
              Recherche, filtres, pagination optimisée et mises en avant dynamiques — le tout
              alimenté par l&apos;API.
            </p>
          </div>
          <Signature />
        </div>
      </FadeIn>
    </section>
  );
}