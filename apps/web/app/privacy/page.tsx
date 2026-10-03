import type { Metadata } from "next";
import { Bullets, Contact, LegalPage, Section, fetchLegalInfo } from "@/components/legal/legal-page";

export const metadata: Metadata = {
  title: "Politique de confidentialité",
  description: "Données collectées par MISTERDOU, pourquoi, qui y accède, combien de temps et comment exercer vos droits.",
};

export default async function PrivacyPage() {
  const info = await fetchLegalInfo();
  const name = info.platformName;
  const operator = info.entityName ?? name;

  return (
    <LegalPage kicker="Informations légales" title="Politique de confidentialité" updated="3 octobre 2026">
      <Section title="1. Responsable du traitement">
        <p>
          Les données sont traitées par {operator}
          {info.address ? `, ${info.address}` : ""}, qui exploite {name}. Contact : <Contact info={info} />.
        </p>
      </Section>

      <Section title="2. Données collectées">
        <Bullets
          items={[
            "Compte : prénom, nom, adresse e-mail, mot de passe (enregistré sous forme d’empreinte, jamais en clair), préférences de langue et de notifications.",
            "Vérification d’identité : pièce d’identité, photo du visage, informations du dossier, et votre position uniquement si vous l’autorisez.",
            "Achats et ventes : commandes, montants, numéro Wave qui a payé, captures des reçus de paiement et des envois de retrait.",
            "Échanges : messages avec l’équipe ou un vendeur, signalements, demandes de code de vérification.",
            "Sécurité : adresse IP, type d’appareil et journal des actions sensibles (connexions, paiements, accès aux identifiants).",
            "Comptes vendus : leurs identifiants de connexion, conservés chiffrés.",
          ]}
        />
      </Section>

      <Section title="3. Pourquoi nous les utilisons">
        <Bullets
          items={[
            "Fournir le service : créer votre compte, traiter vos commandes, livrer les comptes, payer les vendeurs.",
            "Prévenir la fraude et sécuriser les échanges : vérification d’identité, contrôle des paiements, journal de sécurité.",
            "Vous informer : notifications sur vos commandes, paiements et votre compte.",
            "Respecter nos obligations légales et comptables, et traiter les litiges.",
          ]}
        />
        <p>Aucune donnée n’est vendue. Le site n’utilise aucun traceur publicitaire.</p>
      </Section>

      <Section title="4. Qui y a accès">
        <Bullets
          items={[
            "L’équipe autorisée, selon ses permissions (vérification d’identité, paiements, retraits, support). Chaque accès aux documents sensibles est journalisé.",
            "Le vendeur d’un compte que vous achetez voit seulement ce qui est nécessaire à la commande, jamais vos pièces d’identité.",
            "Nos prestataires techniques : hébergement du site et stockage des fichiers (Cloudflare), base de données (Neon), envoi d’e-mails, et Google si vous choisissez la connexion Google. Le paiement lui-même a lieu chez Wave.",
          ]}
        />
      </Section>

      <Section title="5. Sécurité">
        <p>
          Les pièces d’identité, captures et identifiants de comptes sont chiffrés (AES-256-GCM) et ne sont jamais accessibles par
          une adresse publique. Les mots de passe sont protégés par une fonction de hachage lente. Les connexions au site sont
          chiffrées (HTTPS).
        </p>
      </Section>

      <Section title="6. Durée de conservation">
        <p>
          Les données sont conservées tant que votre compte est actif, puis le temps nécessaire au traitement des litiges et au
          respect des obligations légales, notamment comptables. Les documents d’identité ne sont pas conservés au-delà de ce qui est
          nécessaire.
        </p>
      </Section>

      <Section title="7. Cookies et stockage local">
        <Bullets
          items={[
            "Un cookie de session pour vous garder connecté, et un cookie de sécurité contre les requêtes frauduleuses : tous deux indispensables.",
            "Votre langue et votre thème (clair ou sombre), enregistrés sur votre appareil.",
          ]}
        />
      </Section>

      <Section title="8. Vos droits">
        <p>
          Vous pouvez demander l’accès à vos données, leur correction, leur suppression ou vous opposer à un traitement, en écrivant
          à <Contact info={info} />. Certaines données doivent toutefois être conservées pour des raisons légales ou de sécurité.
          Vous pouvez aussi saisir la Commission de protection des données personnelles (CDP) du Sénégal.
        </p>
      </Section>
    </LegalPage>
  );
}
