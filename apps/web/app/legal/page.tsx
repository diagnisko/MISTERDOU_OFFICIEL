import type { Metadata } from "next";
import { Contact, LegalPage, Section, fetchLegalInfo } from "@/components/legal/legal-page";

export const metadata: Metadata = {
  title: "Mentions légales",
  description: "Éditeur, hébergement et propriété intellectuelle du site MISTERDOU.",
};

export default async function LegalNoticePage() {
  const info = await fetchLegalInfo();
  const name = info.platformName;

  return (
    <LegalPage kicker="Informations légales" title="Mentions légales" updated="3 octobre 2026">
      <Section title="Éditeur du site">
        <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-[minmax(0,180px)_1fr]">
          <dt className="text-stone-500">Site</dt>
          <dd>{name}</dd>
          {info.entityName && (
            <>
              <dt className="text-stone-500">Exploitant</dt>
              <dd>{info.entityName}</dd>
            </>
          )}
          {info.address && (
            <>
              <dt className="text-stone-500">Adresse</dt>
              <dd>{info.address}</dd>
            </>
          )}
          {info.registration && (
            <>
              <dt className="text-stone-500">Immatriculation</dt>
              <dd>{info.registration}</dd>
            </>
          )}
          {info.publisher && (
            <>
              <dt className="text-stone-500">Responsable de la publication</dt>
              <dd>{info.publisher}</dd>
            </>
          )}
          <dt className="text-stone-500">Contact</dt>
          <dd>
            <Contact info={info} />
          </dd>
        </dl>
      </Section>

      <Section title="Hébergement">
        <p>
          Le site, son serveur et les fichiers sont hébergés par Cloudflare, Inc. (cloudflare.com). La base de données est hébergée
          par Neon (neon.tech).
        </p>
      </Section>

      <Section title="Propriété intellectuelle">
        <p>
          Les textes, le logo et la présentation du site appartiennent à {info.entityName ?? name}. eFootball et les éléments du jeu
          sont des marques et contenus de KONAMI ; {name} n’est ni affilié à KONAMI ni approuvé par cette société.
        </p>
      </Section>

      <Section title="Paiements">
        <p>Les paiements se font uniquement par Wave. {name} ne reçoit ni ne conserve aucune donnée de carte bancaire.</p>
      </Section>
    </LegalPage>
  );
}
