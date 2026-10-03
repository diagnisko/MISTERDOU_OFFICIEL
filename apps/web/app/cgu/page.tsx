import type { Metadata } from "next";
import Link from "next/link";
import { Bullets, Contact, LegalPage, Section, fcfa, fetchLegalInfo } from "@/components/legal/legal-page";

export const metadata: Metadata = {
  title: "Conditions générales d’utilisation",
  description: "Règles d’achat, de vente, de paiement par Wave et de livraison des comptes eFootball sur MISTERDOU.",
};

export default async function CguPage() {
  const info = await fetchLegalInfo();
  const name = info.platformName;
  const operator = info.entityName ?? name;

  return (
    <LegalPage kicker="Informations légales" title="Conditions générales d’utilisation" updated="3 octobre 2026">
      <Section title="1. Objet">
        <p>
          {name} est une place de marché de comptes eFootball. Elle met en relation des acheteurs et des vendeurs vérifiés, et
          propose aussi ses propres comptes. Ces conditions s’appliquent à toute personne qui crée un compte ou utilise le site,
          exploité par {operator}.
        </p>
      </Section>

      <Section title="2. Compte et vérification d’identité">
        <Bullets
          items={[
            "Un compte est personnel. Les informations fournies doivent être exactes et à jour.",
            "La vérification d’identité (pièce d’identité et photo du visage) est obligatoire avant tout achat ou toute vente.",
            "Vous êtes responsable de la confidentialité de votre mot de passe. En cas d’oubli, utilisez « Mot de passe oublié » sur la page de connexion.",
            `${name} peut suspendre un compte en cas de fraude, de fausse identité, d’abus ou de non-respect de ces conditions.`,
          ]}
        />
      </Section>

      <Section title="3. Prix et paiement par Wave">
        <Bullets
          items={[
            "Les prix sont affichés en francs CFA (FCFA), promotions comprises : le montant affiché est celui à payer.",
            "Le seul moyen de paiement accepté est Wave. Le lien de paiement contient déjà le montant exact à régler.",
            "Après le paiement, vous envoyez la capture du reçu Wave et le numéro qui a payé. L’équipe vérifie la réception de l’argent avant de valider.",
            "Une preuve inexacte ou un montant incomplet est refusé, avec le motif. Vous pouvez alors envoyer une nouvelle preuve.",
            `Le compte est réservé pendant 20 minutes après la commande, puis tant que votre preuve est en vérification. Une commande jamais réglée est annulée au bout de ${info.unpaidOrderExpiryHours} heures.`,
            "Ne payez jamais un vendeur en dehors du site : aucune protection ne s’applique à un paiement direct.",
          ]}
        />
      </Section>

      <Section title="4. Livraison du compte">
        <Bullets
          items={[
            "Dès la validation du paiement, l’e-mail et le mot de passe du compte s’affichent dans « Mes commandes ».",
            "Si le jeu demande un code de vérification, demandez-le depuis la commande : il vous est transmis et reste valable 10 minutes. Vous pouvez en redemander un.",
            "Changez le mot de passe du compte dès votre première connexion.",
            `Confirmez la réception avec « Reçu », ou signalez un problème. Sans réponse ni signalement, la réception est considérée comme acquise ${info.payoutHoldDays} jours après la livraison.`,
          ]}
        />
      </Section>

      <Section title="5. Paiement en plusieurs fois">
        <p>
          Certaines offres peuvent être réglées en plusieurs fois depuis la page « Mensualités » : un apport, puis des mensualités
          à date fixe, chacune payée par Wave. Le compte est livré une fois l’échéancier entièrement réglé. Une échéance non payée
          à temps entraîne des rappels et peut faire passer l’échéancier en défaut.
        </p>
      </Section>

      <Section title="6. Vendeurs">
        <Bullets
          items={[
            `Devenir vendeur nécessite une identité vérifiée et le paiement de frais d’adhésion de ${fcfa(info.sellerRegistrationFee)}.`,
            "Le vendeur garantit qu’il est le propriétaire légitime du compte mis en vente, que sa description est exacte, et qu’il ne cherchera pas à le récupérer après la vente.",
            `Sur chaque vente, une commission de ${info.commissionPercent} % est prélevée. Le reste revient au vendeur et devient disponible quand le client confirme la réception, ou ${info.payoutHoldDays} jours après la livraison sans signalement.`,
            `Les retraits se font uniquement par Wave, à partir de ${fcfa(info.minWithdrawal)}. L’équipe envoie l’argent et joint la capture de l’envoi ; le vendeur confirme ensuite la réception.`,
            "La vente d’un compte volé, piraté ou obtenu frauduleusement entraîne la suspension du vendeur, l’annulation de ses gains et le remboursement de l’acheteur.",
          ]}
        />
      </Section>

      <Section title="7. Signalements et remboursements">
        <p>
          Un problème sur une commande (compte inaccessible, description fausse, vendeur injoignable) se signale depuis la commande.
          L’équipe examine chaque signalement. Si le remboursement est accordé, il est envoyé par Wave au numéro qui a payé, la
          commande est annulée et la part du vendeur lui est retirée.
        </p>
      </Section>

      <Section title="8. Le jeu et son éditeur">
        <p>
          eFootball est une marque de KONAMI. {name} n’est ni affilié à KONAMI ni approuvé par cette société. Les conditions de
          l’éditeur du jeu peuvent encadrer ou restreindre la cession de comptes : l’acheteur et le vendeur le reconnaissent et en
          acceptent les risques.
        </p>
      </Section>

      <Section title="9. Responsabilité">
        <p>
          {name} fournit le service avec soin : vérification des identités, contrôle des paiements, conservation chiffrée des
          identifiants. Sa responsabilité ne peut pas être engagée pour une décision de l’éditeur du jeu, une indisponibilité de Wave
          ou un usage du compte contraire à ces conditions.
        </p>
      </Section>

      <Section title="10. Données personnelles">
        <p>
          Le traitement de vos données est décrit dans la{" "}
          <Link href="/privacy" className="text-[var(--lux-gold-light)] hover:underline">
            politique de confidentialité
          </Link>
          .
        </p>
      </Section>

      <Section title="11. Contact et modifications">
        <p>
          Pour toute question : <Contact info={info} />. Ces conditions peuvent évoluer ; la date de mise à jour figure en haut de
          cette page. Elles sont régies par le droit sénégalais.
        </p>
      </Section>
    </LegalPage>
  );
}
