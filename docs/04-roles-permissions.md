# 04 — Rôles & permissions (RBAC)

Les capacités ci-dessous sont **contrôlées exclusivement côté serveur** (chaque route de
l'API vérifie le rôle + la possession de la ressource). Le frontend peut masquer les actions
par rôle (cosmétique uniquement), mais jamais garantir un accès.

## 1. Rôles

| Rôle | Id (enum) | Périmètre |
|---|---|---|
| Client | `CLIENT` | ses propres données uniquement |
| Vendeur | `VENDOR` | ses produits, ses ordres, ses revenus |
| Staff / Modérateur | `STAFF` | modération catalogue, KYC, support (listes admin) |
| Administrateur | `ADMIN` | accès complet |

Règles de cumul : `VENDOR` implique aussi les droits `CLIENT` (un vendeur peut acheter — §5).
`STAFF` et `ADMIN` héritent également des capacités client pour leurs propres achats.

## 2. Matrice des capacités

Légende : ✅ autorisé · — interdit · A (condition, cf. notes)

| Capacité | CLIENT | VENDOR | STAFF | ADMIN |
|---|---|---|---|---|
| **Compte** | | | | |
| S'inscrire / se connecter (web, Google) | ✅ | ✅ | ✅ | ✅ |
| Modifier profil | ✅ | ✅ | ✅ | ✅ |
| Vérifier téléphone (OTP) | ✅ | ✅ | ✅ | ✅ |
| Fournir consentement localisation | ✅ | ✅ | ✅ | ✅ |
| Voir son dashboard (profil, statuts) | ✅ | ✅ | ✅ | ✅ |
| Voir le dossier d'un utilisateur (admin) | — | — | A¹ | ✅ |
| Suspendre / réactiver un utilisateur | — | — | A¹ | ✅ |
| Changer les rôles | — | — | — | ✅ |
| **KYC** | | | | |
| Soumettre/re-soumettre son dossier | ✅ | ✅ | ✅ | ✅ |
| Consulter son dossier / historique | ✅ | ✅ | — | ✅ |
| Lire l'historique de vérification d'autrui | — | — | A¹ | ✅ |
| Accepter / refuser / demander nouvelle soumission | — | — | ✅ | ✅ |
| **Vendeur** | | | | |
| Demander le statut vendeur (si vérifié) | ✅ | ✅ | — | ✅ |
| Payer les frais d'inscription vendeur | ✅ | — | — | (via compte) |
| Activer / suspendre un vendeur | — | — | A¹ | ✅ |
| **Produits** | | | | |
| Voir le catalogue (cartes publiques) | ✅ | ✅ | ✅ | ✅ |
| Voir la page détail produit | ✅ | ✅ | ✅ | ✅ |
| Créer / éditer / supprimer ses produits (VENDOR) | — | ✅² | — | ✅ |
| Créer des produits ADMIN | — | — | — | ✅ |
| Voir les credentials eFootball avant achat | — | — | — | ✅ |
| Recevoir les credentials après paiement | ✅³ | ✅³ | — | ✅ |
| Approuver / désactiver un produit | — | — | ✅ | ✅ |
| **Commandes & paiement** | | | | |
| Passer commande (si KYC ✅) | ✅ | ✅ | ✅ | ✅ |
| Voir SES commandes / paiements | ✅ | ✅ | ✅ | ✅ |
| Voir TOUTES les commandes / paiements | — | — | ✅ | ✅ |
| Payer par Wave (lien + preuve) | ✅ | ✅ | ✅ | ✅ |
| Voir et valider les paiements Wave | — | — | A¹ | ✅ |
| Faire un remboursement | — | — | — | ✅ |
| **Échéances** | | | | |
| Voir son échéancier | ✅ | ✅ | ✅ | ✅ |
| Payer une échéance | ✅ | ✅ | ✅ | ✅ |
| Agir sur les échéances en retard (relance, waiver) | — | — | A¹ | ✅ |
| **Finances vendeur** | | | | |
| Voir ses commissions / soldes | — | ✅ | — | ✅ |
| Faire une demande de retrait | — | ✅ | — | — |
| Approuver / traiter les retraits | — | — | A¹ | ✅ |
| Contrôler la libération des soldes | — | — | — | ✅ |
| **Promotions / mise en avant** | | | | |
| Créer des promotions (produits admin) | — | — | — | ✅ |
| Acheter la mise en avant de son produit | — | ✅ | — | — |
| Mettre un produit en avant (force) | — | — | — | ✅ |
| Contrôler/gérer toutes les mises en avant | — | — | A¹ | ✅ |
| **Support & messagerie** | | | | |
| Ouvrir un ticket support (ses ordres) | ✅ | ✅ | ✅ | ✅ |
| Traiter les tickets / codes de vérification | — | — | ✅ | ✅ |
| Discuter avec l'administration | ✅ | ✅ | ✅ | — |
| Discuter avec un client directement | — | — | ✅ | ✅ |
| Discuter avec un vendeur directement | — | — | ✅ | ✅ |
| **Administration** | | | | |
| Dashboard admin complet | — | — | A¹ | ✅ |
| Modifier les Settings (frais, commissions…) | — | — | — | ✅ |
| Voir les logs de sécurité / audit | — | — | A¹ | ✅ |
| Gérer les rôles | — | — | — | ✅ |
| Exécuter des actions critiques (confirmées) | — | — | — | ✅ |

## 3. Notes

- **A¹ (Staff, accès listes)**: le Staff ne peut **lire** des données d'autres utilisateurs
  que dans les écrans de modération pour lesquels il est habilité (KYC, produits en revue,
  tickets, transactions de la plateforme). Il ne peut **jamais** voir les données de retrait
  bancaire ni changer les rôles. Saisie en `AuditLog` de chaque consultation sensible.
- **² VENDOR** : ne peut créer/éditer que ses propres produits. La modération (`PENDING_REVIEW`
  → `ACTIVE`) relève de STAFF/ADMIN. Un produit passe systématiquement par une revue avant
  publication (anti-fraude).
- **³ Livraison des credentials** : le client (ou un vendeur-acheteur) reçoit les accès eFootball
  **après** validation du paiement Wave par l'équipe (preuve vérifiée). Attribution par ordre
  sur la commande. Un admin peut consulter les credentials de tout produit.

## 4. Implémentation serveur

- Middleware `requireRole(...roles)` + `requireOwnership(resource, userId)`.
- Les capacités sont des constantes partagées (`packages/shared`) : `CanAction.xxx`.
- La vérification s'applique **dans le service** (pas seulement dans la route) pour couvrir
  les appels internes (jobs, webhooks) — éviter les chemins d'exécution non contrôlés.