# 06 — Paiements PayTech & génération d'échéances

Ce document décrit : (1) l'intégration PayTech de bout en bout avec **confiance serveur
uniquement**, (2) l'algorithme de génération des échéanciers avec **arrondi exact**,
(3) la libération des soldes vendeurs et les flux financiers annexes.

> Principe (§14/§33/§65) : une redirection frontend n'est **jamais** une preuve de paiement.
> Seul le statut vérifié en backend (webhook signé + vérification montant/référence + contrôle
> d'état serveur) fait évoluer les soldes, commandes et livraisons.

---

## 1. Pipeline « payer un ordre »

### 1.1 Création de l'ordre et de la transaction interne

```
Client (web/mobile)          API (/api/v1)                    PayTech
      │  POST /orders              │                             │
      │  (produit, KYC requis vérifié)                            │
      │────────►│ 1. Vérif KYC + disponibilité + tarif (basePrice - promo) │
      │         │ 2. Création Order (PENDING_PAYMENT)            │
      │         │    + OrderItem + snapshot produit              │
      │◄────────│ 3. { orderNumber, totalAmount }                │
      │  POST /payments (orderId) │                             │
      │────────►│ 4. Vérif serveur : montant == totalAmount      │
      │         │ 5. Créer Payment(PENDING) + transactionToken   │
      │         │    (idem idempotence, unique)                  │
      │         │ 6. Appel PayTech : createPayment               │
      │         │    { amount, reference=paymentNumber,          │
      │         │      customer(phone/email), callback }         │
      │         │◄═════════ token + payment_url ────────────────►│
      │◄────────│ 7. Payment(PROCESSING) → { redirect_url }      │
      │──── PayTech Checkout/Hosted ───────────────►│
```

- Le montant envoyé à PayTech est **recalculé côté serveur** à partir de la DB (pas du
  body du client, sauf pour un retry relu depuis la dernière `Payment`).
- `transactionToken` : uuid unique créé côté serveur — clé d'**idempotence** (`UNIQUE` en base) :
  un éventuel double POST /payments ne crée pas deux transactions payantes.

### 1.2 Attente de confirmation

- Le client est redirigé vers la page PayTech et **peut être redirigé en retour**
  (`?success=1&reference=…`) — cette redirection est **ignorée** pour toute mutation :
  l'UI affiche « Paiement en cours de vérification… » tant que le webhook ou le poll serveur
  n'a pas confirmé.

### 1.3 Webhook → vérification → mise à jour (flux d'état atomique)

```
PayTech ─ webhook POST /webhooks/paytech
      │
      ▼
API :
1. Signature : HMAC-SHA256(corps, PAYTECH_WEBHOOK_SECRET) == header signature   (sinon 401, pas d'ACK)
2. IP allowlist + fenêtre temporelle (replay : timestamps > 5 min rejetés)
3. Référence : retrouve Payment(providerReference) ; sinon recherche par paymentNumber
4. Montant : montant reçu == montant attendu de la Payment (sinon FLAG + audit, surtout pas d'ACK succès)
5. Transaction unique : UPDATE Payment SET status … WHERE id=? AND status ∈ (PENDING, PROCESSING)
   → si aucune ligne affectée : réponse 200 (idempotent) — PAS de double crédit.
6. Si SUCCESS :
   - Payment → SUCCESS, paidAt, verifiedAt=now, verifiedBy=SYSTEM
   - side effects transactionnels (même tx SQL) :
       a. Commande → PAID (ou PARTIALLY_PAID si échéancier)
       b. Livraison credentials (si payable en 1 fois : encaissement complet)
       c. InstallmentPlan : payer l'échéance correspondante
       d. Commission + crédit SellerBalance (pending si hold, sinon disponible)
       e. Notifications (client + admin + vendeur)
       f. AuditLog PAYMENT_SUCCESS
7. Réponse 200 au webhook (ACK) ; en cas d'erreur, 500 → PayTech retente (idempotence safe)
```

**Toutes les écritures monétaires sont dans une transaction unique** avec verrous :
`SELECT … FOR UPDATE` sur `Order`, `Payment`, `SellerBalance` (+ `Installment` si concerné).
Deux webhooks concurrents pour la même reference ne peuvent pas double-créditer.

### 1.4 Contrôle d'état (renfort, mobile, webhook perdu)

- Le webhook étant la source de vérité, un **job de réconciliation** pollates PayTech
  (`GET /api/…/transactions/{reference}`) pour toute Payment restée `PROCESSING` > X min,
  et applique le même flux d'état via le même service (`settlePayment`).
- L'API ne marque jamais `SUCCESS` sans preuve serveur (webhook vérifié ou GET d'état vérifié).

### 1.5 Statuts & transition

`PENDING → PROCESSING → SUCCESS`
`PROCESSING → FAILED | CANCELLED`
`SUCCESS → REFUNDED` (admin, actions critiques, confirmées §25)
Toute autre transition = refusée (guard de `settlePayment`).

---

## 2. Génération des échéances (produits admin, §8–§9)

### 2.1 Règles de saisie (forces côté serveur)
- `installmentMonths ∈ [1, maxInstallments(8)]` — `maxInstallments` vient des **Settings**,
  plafonné par la constante serveur `INSTALLMENT_HARD_CAP = 8`.
- `downPayment ≥ 0` et `downPayment ≤ total` ; le plan ne démarre que sur un `downPayment > 0`
  affiché (sinon `NOT_ENOUGH`), configurable par l'admin.
- Paiement initial = `downPayment` lors de l'ordre ; les `installmentMonths` échéances suivantes
  tombent au *même jour du mois* que la commande (règle de report en fin de mois).

### 2.2 Algorithme d'arrondi : `Total ≈ exact (jamais de différence)`

```
Entrées : total (int), down (int), n (int, ≥ 1)
Reste : R = total − down            (R entier, FCFA)
si n == 1 : [R]
sinon :
  q = R DIV n ; r = R MOD n          (division entière)
  mois = [q, q, …, q]   (n fois)
  # distribution du reste r sur les r premières échéances (Settings.installmentRounding = FIRST|LAST|BALANCED)
  si FIRST   : mois[k] += 1 ; k = 0..r−1
  si LAST    : mois[n−1−k] += 1 ; k = 0..r−1
  si BALANCED : pour k = 0..r−1 : mois[(k * n / r) arrondi] += 1   # répartition uniforme
Vérification (obligatoire, dans le même tx) :
  down + Σ mois = total   (sinon erreur 500 / rollback)

Exemple : total 80 000, down 20 000, n=6 → R=60 000 ; q=10 000 ; r=0  → 6× 10 000
Exemple : total 100 000, down 10 000, n=3 → R=90 000 ; q=30 000 ; r=0 → 3× 30 000
Exemple : total 12 500, down 0, n=2 → R=12 500 ; q=6 250 ; r=0 → 6 250×2 (paire)
Exemple : total 100 000, down 0, n=3 → R=100 000 ; q=33 333 ; r=1 → FIRST: [33 334, 33 333, 33 333]
```
- Tous les montants sont des **entiers** (FCFA sans centimes) ; aucun calcul en virgule
  flottante (division entière). `InstallmentPlan.lastMonthAmount` documente l'ajustement.
- Le plan est persisté dans le **même transaction** que l'Order : lecture future = cohérente.

### 2.3 Saisie/mémorisation des échéances

`Installment` : index `1..n`, `amountDue`, `dueDate`, `status PENDING`. Jobs :
- **Rappel** : `PENDING` et `dueDate ≤ now` → `OVERDUE` + notification « échéance en retard ».
- **Gréement admin** (paramètre `payment_grace_days`) : échéance non payée dans X jours après dueDate
  → plan `DEFAULTED`, blocage de nouveaux achats si config, relance.
- Paiement d'une échéance : `Payment(type=INSTALLMENT)` via le même pipeline §1 (webhook).

---

## 3. Règles financières globales

### 3.1 Commission + solde vendeur (§7, §17)
Au `settlePayment` d'une vente vendeur (commande `PAID`) :
```
brut             = OrderItem.unitPrice (après promo)
commissionRate   = Settings.sellerCommissionPercent  (15 %)
commission       = round(brut * rate / 100)          (entier)
netVendor        = brut − commission
```
- Si `Settings.paymentFeesBearer = SELLER` (option, cf. docs/01 R1) : `netVendor −= fees`.
- Crédit (`Commission` + `SellerBalance`) : mode **pending** (hold) par défaut
  (`payoutHoldDays` défaut 3), sinon **available**. Le passage available se fait par le job de
  libération (ou admin) dans une transaction verrouillée. Chaque écriture = ligne `Commission`
  + notification vendeur ; audité.
- **Jamais** de crédit sur déclaration frontend : uniquement dans le flux `settlePayment`
  (webhook/GET d'état vérifié).

### 3.2 Retrait (§17)
1. Contrôles : solde disponible ≥ montant ; profile KYC `VERIFIED` ; infos retrait complètes
   (Settings `withdrawal_required_fields`) ; pas de litige ouvert.
2. `Withdrawal(PENDING)` → débite le solde immédiatement (réservation) → admin approuve →
   ordre de paiement (PayTech payout ou manuel selon market — hors scope impl pour Phase 1).
   Échec : crédite à nouveau (restitution) en transaction.
3. Seuil minimum : `Settings.withdrawalMinAmount` (défaut à définir par le PO).

### 3.3 Mise en avant (§13)
- `cost = dailyRate * days` (int, `dailyRate = Settings.featuredDailyRate` = 200).
- Mode `BALANCE` (par défaut) : débit du solde **disponible** ; mode `PAYTECH` : pipeline §1
  avec `type=FEATURED`. Toujours une `Payment` tracée.
- Après succès : `FeaturedProduct(ACTIVE, startedAt, expiresAt)` ; job d'expiration daily.
- Aucun remboursement si le produit est vendu avant expiration (cf. docs/01 R9, configurable).

### 3.4 Remboursement
- Réservé ADMIN, action critique (2FA + confirmation). `Refund` reflète le total de l'ordre
  échelonné payé à date ; débit du vendeur via ajustement de solde ; statut `REFUNDED` ;
  credentials révoqués si déjà livrés.

---

## 4. Ops indispensables côté produit
- `PAYTECH_API_KEY`, `PAYTECH_WEBHOOK_SECRET`, `PAYTECH_SANDBOX=true` en dev, URL callback/webhook
  d'INDENT interne datés (env). Comptes de test PayTech fournis par la marketplace requise.
- Signature exacte HMAC : à adapter/confirmer avec la doc PayTech réelle (env `paytech_signature_method`).
- Webhook route **publique** mais dédiée (signature + IP), hors rate-limit général, et hors CSRF.