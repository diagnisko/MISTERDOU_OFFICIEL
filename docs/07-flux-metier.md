# 07 — Flux métier (parcours utilisateurs)

Parcours complets : onboarding client, onboarding vendeur, vente/livraison, admin,
messagerie, échéances, notifications. Les vérifications (KYC, statuts) sont côté serveur.

---

## 1. Onboarding CLIENT

```
[1] Inscription
      ├─ Classique : téléphone (indicatif + numéro) [+ email optionnel]
      └─ Google OAuth : compte Google → champ téléphone complété ensuite
[2] OTP SMS  : envoi → saisie → PhoneVerification=VERIFIED (limite : 3 essais)
[3] Profil   : nom, prénom, date de naissance (éventuel), pays, ville, adresse (éventuel)
[4] Consentement + localisation (bouton explicite, one-shot, non suivie) :
      navigateur/geolocation → Location(consentGivenAt) ; adresse approximative
[5] KYC :
      - pièce nationale (recto + verso) OU passeport
      - selfie
      - statuts : PENDING → IN_PROGRESS → VERIFIED | REJECTED (motif, re-soumission)
      Chaque soumission = nouvelle IdentityVerification ; historique conservé
[6] Compte validé ⟶ peut passer commande (KYC obligatoire, vérifié à CHAQUE pas de
    checkout & payment : R17)
```

Règles
- Téléphone jamais public ; unique par compte actif (R11).
- Localisation : consentement révocable (`revokedAt` → on efface les coordonnées).
- Toute modification sensible post-KYC (nom, pièce, pays) ⇒ nouvelle vérification requise,
  ancien dossier dans l'historique (§57).

---

## 2. Onboarding VENDEUR

```
[1] Client vérifié (KYC VERIFIED) demande le statut vendeur
[2] Paiement frais (SellerRegistrationFee = Settings, défaut 1 000 FCFA, définitif)
      via pipeline PayTech (docs/06) — Payment(type=SELLER_REGISTRATION_FEE)
[3] Après SUCCESS serveur : Seller(ACTIVE, sellerSince, registrationFeeAmount snapshot)
[4] Dashboard vendeur activé : publier, gérer, suivre
```

Règles
- L'inscription n'est **jamais** activée sur redirection frontend ; seul le webhook compté.
- Le vendeur reste client (ses droits CLIENT conservés).

---

## 3. Publication d'un produit vendeur

```
[1] Vendeur saisit : titre, description, price, teamPower, coins, division, compléments
    + captures d'écran (ProductImage, stockage privé)
    + credentials eFootball (ProductCredential, CHIFFRÉ, jamais en projection publique)
[2] Statut DRAFT → PENDING_REVIEW
[3] STAFF/ADMIN : ACcepter (ACTIVE) ou REJETER (motif) — audités
[4] PUBLIC : visible catalogue/search ; credentials jamais exposées
```

Règles
- `PaymentMode = ONE_TIME` imposé pour les produits VENDOR (§6).
- Aucune donnée privée (email/password du compte, docs vendeur) en sortie publique (§6/§10/§11).
- Produit supprimé/désactivé : `ARCHIVED`/`SUSPENDED` ; pas de suppression physique des ventes
  passées (soft).

---

## 4. Achat / livraison

### 4.1 Produit vendeur (ONE_TIME)
```
Catalogue → Détail → « Acheter » (KYC requis) → POST /orders → POST /payments
→ redirection PayTech → webhook vérifié → Payment=SUCCESS
→ Order=PAID → OrderItem snapshot → credentials révélés au client (après paiement)
→ Commission 15% + crédit solde vendeur (pending hold) → notifications + audit
```

### 4.2 Produit admin (ONE_TIME ou INSTALLMENTS)
```
Paiement complet → commande PAID → livraison
Paiement échelonné :
  POST /orders → calcul plan (docs/06 §2) :
      payDown = downPayment
      InstallmentPlan(ACTIVE, totalPaid=0) ; échéances 1..n
  → POST /payments (type=INITIAL_INSTALLMENT, montant = dowPayment)
  → webhook SUCCESS → Order=PARTIALLY_PAID ; InstallmentPlan.totalPaid += down
  → livraison (paramètre admin_delivery_after = INITIAL_PAYMENT par défaut — R5)
  → échéance i : POST /payments(type=INSTALLMENT) → webhook → Installment=PAID,
      plan.totalPaid += amountDue
  → quand toutes échéances payées : plan=COMPLETED, Order=COMPLETED
Client voit (dashboard) : total, payé, restant, prochaine échéance, historique,
échéances OVERDUE (§9, §19).
```

---

## 5. Mises en avant & promotions

```
Mise en avant (vendeur) : choisit produit + jours → coût calculé serveur (dailyRate × jours)
  → paiement BALANCE (débit solde disponible) ou PAYTECH (webhook)
  → FeaturedProduct(ACTIVE, expiresAt) → badge « Mis en avant » + emplacements
  → job daily : expiration automatique + notification vendeur
Promo (admin) : Promotion(SCHEDULED→ACTIVE, début/fin, promoPrice OU discountPercent)
  → le prix affiché et facturé = promoPrice (le UI ne calcule rien)
  → à l'expiration, retour au basePrice ; historique conservé
```

---

## 6. Flux ADMIN (workflows)

| Workflow | Actions admines |
|---|---|
| KYC | consulter dossier → accepter / refuser (motif) / demander nouvelle soumission → AuditLog |
| Produits | ajouter (produits ADMIN + INSTALLMENTS), modifier, désactiver, mettre en avant, promos |
| Vendeurs | approuver, suspendre, voir ventes/commissions, gérer paiements |
| Paiements | toutes transactions, statuts, recherche par référence PayTech |
| Retraits | approuver / rejeter (réservation & restitution atomiques) |
| Commandes | suivi, remboursement (2FA + confirmation), relance échéances |
| Settings | commission %, frais vendeur, featuredDailyRate, maxInstallments (≤8), règles paiement |
| Sécurité | logs, sessions, révocation, alertes |

Actions critiques (confirmation supplémentaire §25) : suppression massive, modification
financière, changement de rôle, modification des paramètres de paiement.

---

## 7. Messagerie (§41–§44, §43)

- Conversations **strictement** : `CLIENT ↔ ADMIN/STAFF` et `VENDOR ↔ ADMIN/STAFF`.
- Construction : `Conversation(kind, participantA, participantB)` — un trigger/contrôle
  applicatif garantit que B est bien STAFF/ADMIN ; aucune route ne permet de créer
  Client↔Vendeur (il n'y a pas de `sellerId` exposable).
- Détection de violation : toute tentative de créer une conversation non conforme = 403 + audit.
- UI (web puis mobile) : liste (dernier message, non-lus, date), conversation (bulles, lu/non-lu,
  heure/date), pièces jointes éventuelles (objets privés, ticket signé).
- Notifications à la réception + centre de notifications ; `Message.isSystem` pour les
  messages automatiques.

---

## 8. Tickets de support (§16)

- Client/vendeur → `SupportTicket(orderId?, subject, category)` :
  - `VERIFICATION_CODE` « J'ai besoin du code de vérification » **uniquement** si l'ordre est payé.
- Chef d'équipe assigne un STAFF ; édition du statut CREATED→PENDING→IN_PROGRESS→RESOLVED→CLOSED ;
  toutes actions dans AuditLog. L'aide (code) est communiquée par le canal sécurisé (messagerie/ticket).

---

## 9. Notifications (§30, §45–§47, §58–§61)

- Événements → Notification(IN_APP) + (EMAIL/SMS/PUSH selon préférences & criticité) :
  | Acteur | Événements |
  |---|---|
  | Client | KYC accepté/refusé, message, commande confirmée, paiement confirmé, prochaine échéance, échéance proche/retard, problème commande |
  | Vendeur | message admin, produit vendu, paiement confirmé, commission, solde disponible, retrait, produit refusé/désactivé, promo, mise en avant activée/expirée |
  | Admin | nouveau client, KYC à traiter, demande vendeur, paiement, retrait, produit, message, support, problème paiement, alertes sécurité |
- Centre : type, titre, contenu, date, lu/non-lu, actionUrl, « tout marquer lu ».
- Préférences par canal ; notifications critiques non désactivables (paiement, sécurité).

---

## 10. Vues « dashboard » cibles (server-rendered chiffres)

- **CLIENT** : profil + statut KYC, commandes, comptes achetés, paiements, échéanciers,
  prochaines échéances, historique, support, notifications.
- **VENDEUR** : nb produits, actifs, vendus, ventes en attente, revenus, commissions,
  solde disponible, solde en attente, historique transactions, mise en avant, dépenses promo
  + actions (ajouter/modifier/supprimer, MES commandes, revenus, acheter mise en avant).
- **ADMIN** : KPIs (utilisateurs, clients, vendeurs, produits, commandes, paiements, revenus,
  commissions, KYC, retraits, promos, mises en avant, tickets, logs sécurité) —
  chaque chiffre = agrégation serveur, jamais du frontend.