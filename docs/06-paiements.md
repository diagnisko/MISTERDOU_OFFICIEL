# 06 — Paiements par Wave & génération d'échéances

Ce document décrit : (1) le paiement par **lien Wave Business** vérifié par l'équipe,
(2) l'algorithme de génération des échéanciers avec **arrondi exact**, (3) la libération des
soldes vendeurs, les retraits et les flux financiers annexes.

> Principe (§14/§33/§65) : une action du navigateur n'est **jamais** une preuve de paiement.
> Seule la validation d'un membre de l'équipe (administrateur ou manager `PAYMENTS`), après
> vérification de la réception dans Wave Business, fait évoluer les soldes, commandes et livraisons.

Wave est le seul moyen de paiement du site (paiements reçus et retraits envoyés).

---

## 1. Pipeline « payer un ordre »

### 1.1 Création de l'ordre et de la transaction interne

```
Client                         API (/api/v1)
  │  POST /orders                 │
  │──────────────────────────────►│ 1. KYC + disponibilité + prix (promo comprise)
  │                               │ 2. Order (PENDING_PAYMENT) + OrderItem (snapshot)
  │                               │ 3. Payment (PENDING, provider WAVE_LINK, transactionToken)
  │◄──────────────────────────────│ 4. { token } → page /checkout/<token>
  │  GET /payments/<token>        │
  │──────────────────────────────►│ 5. montant + lien Wave avec ?amount=<montant>
```

- Le montant est **toujours calculé côté serveur** : prix de l'offre, apport d'un achat en
  plusieurs fois, ou total des mensualités choisies. Il est écrit dans le lien Wave Business
  réglé dans Console > Paramètres (`waveMerchantLink`), par exemple
  `https://pay.wave.com/m/<marchand>/c/sn/?amount=5000`.
- `transactionToken` : identifiant unique créé côté serveur, clé d'**idempotence** (`UNIQUE`).

### 1.2 Preuve de paiement

```
Client                                   API
  │ paie dans Wave (montant déjà rempli)  │
  │ POST /uploads (purpose=payment_proof) │ capture chiffrée (stockage privé)
  │ POST /payments/<token>/proof ────────►│ 1. paiement PENDING, capture du client
  │   { proofKey, senderPhone,            │ 2. ID Wave déjà utilisé ailleurs → refus
  │     waveReference? }                  │ 3. Payment → PROCESSING + PaymentProof (PENDING)
  │                                       │ 4. alerte « Paiement Wave à vérifier »
  │                                       │    (administrateurs + managers PAYMENTS)
```

- Pendant la vérification, le compte reste réservé au client (aucune autre commande possible).
- Le client voit « Paiement en cours de vérification » ; il peut fermer la page.

### 1.3 Vérification par l'équipe (Console > Paiements)

1. L'équipe compare la capture, le montant et le numéro payeur avec Wave Business.
2. **Valider** : `PaymentProof → APPROVED`, puis `settlePayment(SUCCESS, source MANUAL)` :
   - Payment → SUCCESS, paidAt, verifiedAt ;
   - side effects transactionnels : commande livrée (identifiants), échéancier mis à jour,
     commission + part du vendeur **en attente**, notifications (client, vendeur « Bravo »),
     AuditLog `PAYMENT_SUCCESS` et `PAYMENT_PROOF_APPROVED`.
3. **Refuser** (motif obligatoire) : `PaymentProof → REJECTED`, Payment repasse `PENDING` ;
   le client reçoit le motif et peut envoyer une nouvelle preuve.

`settlePayment` est l'unique porte d'évolution de statut : `UPDATE … WHERE status ∈ (PENDING,
PROCESSING)` — une double validation ne crédite jamais deux fois.

### 1.4 Statuts & transition

`PENDING → PROCESSING (preuve envoyée) → SUCCESS (validée)`
`PROCESSING → PENDING (preuve refusée)`
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
- Paiement d'une échéance : `Payment(type=INSTALLMENT)` via le même pipeline §1 (lien Wave + preuve).

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
  (preuve Wave validée par l'équipe).

### 3.2 Retrait (§17)
1. Contrôles : solde disponible ≥ montant ; profil KYC `VERIFIED` ; numéro Wave du vendeur.
2. `Withdrawal(PENDING)` → débite le solde immédiatement (réservation) → l'équipe peut
   « prendre en charge » (délai annoncé) → elle envoie l'argent **par Wave** puis clique « Payé »
   en joignant **obligatoirement** la capture de l'envoi (`Withdrawal.proofKey`, stockage privé).
3. Le vendeur voit la capture et répond « Je l'ai reçu » (`COMPLETED`) ou « Pas reçu »
   (`sellerDisputedAt` + note, alerte aux administrateurs et managers `WITHDRAWALS`).
4. Refus : crédite à nouveau le solde (restitution) en transaction.
5. Seuil minimum : `Settings.minWithdrawalAmount`.

### 3.3 Mise en avant (§13)
- `cost = dailyRate * days` (int, `dailyRate = Settings.featuredDailyRate` = 200).
- Mode `BALANCE` (par défaut) : débit du solde **disponible** ; mode `WAVE` : pipeline §1
  avec `type=FEATURED`. Toujours une `Payment` tracée.
- Après succès : `FeaturedProduct(ACTIVE, startedAt, expiresAt)` ; job d'expiration daily.
- Aucun remboursement si le produit est vendu avant expiration (cf. docs/01 R9, configurable).

### 3.4 Remboursement
- Réservé ADMIN, action critique (2FA + confirmation). `Refund` reflète le total de l'ordre
  échelonné payé à date ; débit du vendeur via ajustement de solde ; statut `REFUNDED` ;
  credentials révoqués si déjà livrés.

---

## 4. Ops indispensables côté produit
- Lien Wave Business dans Console > Paramètres (`waveMerchantLink`, doit commencer par
  `https://pay.wave.com/`) ; vide = paiement indisponible.
- Toujours vérifier la réception **dans Wave Business** avant de valider : une capture peut être
  falsifiée et le montant du lien peut être modifié par le client.
- Les captures (paiements et retraits) sont chiffrées et servies uniquement aux personnes
  autorisées (`Cache-Control: private, no-store`).
