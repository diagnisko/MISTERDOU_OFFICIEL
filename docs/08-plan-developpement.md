# 08 — Plan de développement (14 phases)

> **Mise à jour du 2026-10-02** : PayTech et Orange Money ont été retirés. Les paiements se font uniquement par lien Wave Business, vérifiés par l'équipe (voir docs/06). Les passages ci-dessous qui citent l'ancien prestataire décrivent l'historique du projet.

Chaque phase = périmètre du cahier des charges + critères d'acceptation + plan de test.

| Phase | Intitulé | Périmètre (réf.) | Statut |
|---|---|---|---|
| P1 | Architecture + BDD + authentification | §38 | **✅ livrée** (+ refonte auth : e-mail/mot de passe, Google OAuth, `/account`) |
| P2 | Vérification d'identité (KYC) | §4, §50–§56 | **✅ livrée** |
| P3 | Catalogue produits | §6, §10–§11, §28–§29 | **✅ livrée** |
| P4 | Système vendeur | §5, §17–§18 (dashboard) | **✅ livrée** (frais via stub dev — webhook réel en P5) |
| P5 | Paiements PayTech | §14, §33, docs/06 | **✅ livrée** (pipeline idempotent + webhook signé + checkout Wave/OM) |
| P6 | Commandes | §15, §32 | **✅ livrée** (achat catalogue → checkout P5 → livraison idempotente des credentials, CRUD identifiants produit, « Mes achats » + révélation, console `/admin/orders` avec remboursement) |
| P7 | Paiement en plusieurs fois | §8–§9, docs/06§2 | à faire (l'UI admin d'encaissement/solde existe — voir P8) |
| P8 | Dashboard administrateur | §20, §35, §53–§54,§25 | **✅ livrée** (console `/admin` : KPIs, graphiques, clients, vendeurs, plans, équipe, params, journal) |
| P9 | Promotions & mise en avant | §12–§13 | à faire |
| P10 | Support & notifications | §16, §30, §41–§47, §58–§61 | à faire |
| P11 | Sécurité avancée | §22–§25, §64 | à faire |
| P12 | Optimisation performances | §28 | à faire |
| P13 | Tests | §39 | à faire |
| P14 | Déploiement production | §40 | à faire |

---

## Phase 1 — Architecture + base de données + authentification ✅ (livrée)

**Contenu** : monorepo pnpm (web/api/db/shared), shéma Prisma complet, module auth +
sessions + OTP stub + Google OAuth stub + settings + audit/session branchés, health, startup web.
**Acceptation** : `pnpm install` ✓ ; `prisma generate` ✓ ; `next build` ✓ ; API health ✓ ;
DMZ : register/login/logout/récup session.
**Tests** : auth (register normalize, login ok/fail, logout, rate-limit, cookie flags).
**Docs livrées dans `docs/01…08`.**

**Refonte auth (livrée en post-P1)** : inscription/connexion e-mail + mot de passe, Google
OAuth (bouton sur login/register), shell `auth-shell` partagé, layouts `noindex` sur les pages
d'auth, redirection post-connexion vers `/account` (plus `/?logged=1`), ouverture du compte par
« Mon espace ». Identifiants admin bootstrappés via `ADMIN_BOOTSTRAP_*` (script `pnpm
admin:bootstrap`) ; rate-limit login 5/min/IP.

## Phase 2 — Vérification d'identité ✅ (livrée)
- Upload docs (stockage privé chiffré), soumission, statuts multiples, historique, workflow admin
  (accepter/refuser/re-soumettre), dossier permanent, accès par ticket signé, audit d'accès.
- **Acceptation** : scénario §64 client complet jusqu'aux docs ; docs jamais publics ;
  consultation admin tracée.
- **Tests** : accès document (auth, ticket expiré, réutilisé, autre utilisateur), enumeration.

## Phase 3 — Catalogue produits ✅ (livrée)
- CRUD produits (ADMIN + VENDOR draft), images privées → publication, recherche/filtres/pagination
  (pg_trgm + index docs/03), page détail, badges promo/mis en avant, priorités d'affichage.
- **Acceptation** : catalogue paginé < 150 ms ; filtres documentés ; aucune credential exposée
  (assert tests sur les projections).
- **Tests** : API pairages des scopes (products publics vs privés), recherche, pagination.

## Phase 4 — Système vendeur ✅ (livrée)
- Demande vendeur + paiement frais (via webhook ; attention R2/R5/R10) + statuts, dashboard vendeur
  (KPIs serveur), soldes pending/available (libération job), retraits (workflow admin).
- **Acceptation** : aucun crédit sans preuve serveur ; retrait conditionné (infos complètes).
- **Tests** : paiement frais, hold/release, retrait, multi-vendeurs isolés.
- **Livrée** : `PendingCredit` + libération lazy idempotente (hold `payoutHoldDays`, notif à la
  libération), dashboard `/seller` (soldes, KPIs serveur, crédits, retraits), demande de retrait
  (débit atomique, snapshot bancaire AES-256-GCM), workflow admin `/admin/withdrawals`
  (approbation avec réf. / refus avec remboursement atomique + audit + notifications), isolation
  multi-vendeurs. Smoke API 14/14 ; frais d'activation sur stub dev (webhook réel → P5).

## Phase 5 — Paiements PayTech ✅ (livrée) — le socle transactionnel de tout
- Pipeline §1 docs/06 : transaction interne, appel PayTech (API key sandbox), webhook signé,
  vérif montant/référence, idempotence, réconciliation, statuts, historique, remboursements.
- **Acceptation** : un paiement ne peut être crédité qu'une fois ; double webhook inoffensif ;
  webhook falsifié rejeté (en-tête signature + montant + référence).
- **Tests** : succès/échec/annulé/reboot, concurrence 2 webhooks simultanés, montant altéré.
- **Livrée** : `settlePayment` unique atomique (UPDATE WHERE PENDING/PROCESSING → idempotent,
  side-effects par type, audit `PAYMENT_SUCCESS` + notifications), checkout Wave / Orange Money
  (mode local dev sans clé / redirection fournisseur réel, état public par `transactionToken`),
  webhook HMAC-SHA256 + fenêtre ±300 s + IP + montant/référence (audit CRITICAL), réconciliation
  périodique 60 s, remboursements admin (`SUCCESS → REFUNDED` atomique), historique `GET
  /payments` + liste/pagination admin. Web : page `/checkout/[token]` (boutons Payer avec Wave /
  Orange Money, poll de vérification, redirection selon type) + CTA « Payer maintenant » sur
  `/seller/apply` — **zéro « PayTech » affiché**. Env : `PAYTECH_WEBHOOK_SECRET` (HMAC) ;
  `PAYTECH_API_KEY/SECRET` absents → mode local. Smoke API **18/18** (settle local, idempotence
  webhook, anti-replay, montant altéré, signature fausse, isolation multi-vendeurs, refund,
  rejeu sur REFUNDED, HTML sans « PayTech »).

## Phase 6 — Commandes ✅ (livrée)

**Contenu**
- **Commande** (`apps/api/src/modules/orders`) : `POST /orders` (montant recalculé serveur, refus
  si compte non ACTIVE ou KYC ≠ VERIFIED), `GET /orders/mine`, `GET /orders/:id`,
  `GET /orders/:id/reveal` (propriétaire seul, journalisé).
- **Livraison** : `deliverOrderAfterSuccess` branché sur `settlePayment` (`ORDER_PAYMENT` /
  `INITIAL_INSTALLMENT`) — idempotence par `Order.deliveredAt`, KYC re-vérifié à la délivrance
  (blocage `KYC_REVOKED` + audit CRITICAL), notification `ORDER_DELIVERED`.
- **Console admin** : `/admin/orders` (perm `ORDERS` pour consulter, `PAYMENTS` pour rembourser) —
  liste filtrée (statut, recherche), fiche (client/KYC, articles, paiements), **remboursement**
  tracé (motif 5-500 car., audit CRITICAL, notification `ORDER_REFUNDED`) ; un remboursement
  **révoque l'accès** (la révélation renvoie `ORDER_REFUNDED`).
- **Identifiants produit** (`apps/api/src/modules/credentials`) : `GET/PUT/DELETE
  /admin/products/:id/credentials` (perm `PRODUCTS`). Un jeu chiffré AES-256-GCM par produit, saisi
  depuis la fiche de commande. La lecture ne renvoie **jamais** le secret (existence + date +
  nombre de commandes livrées dépendantes). Règles de sécurité :
  - remplacer les identifiants d'un produit **déjà livré** est refusé `409 CREDENTIALS_IN_USE`
    tant que `force` n'est pas explicite — sans cela on couperait l'accès d'acheteurs payés ;
  - poser un **premier** jeu sur un produit livré ne l'exige pas (aucun accès coupé) ;
  - supprimer est refusé tant que des commandes livrées en dépendent ;
  - toute écriture est auditée `PRODUCT_CREDENTIAL_SET` / `_REPLACED` / `_CLEARED` en sévérité
    CRITICAL, et les acheteurs déjà servis sont notifiés (`ORDER_DELIVERED`) pour reconsulter.
- **Façade** : bouton « Acheter » réel sur la fiche produit (redirige vers le checkout P5, sinon
  `/login`), carte « Mes achats » dans `/account` avec révélation à la demande. `/account` a été
  aligné sur le design lux du site (fond, navigation, typographie, cartes verre) et la connexion
  redirige désormais `ADMIN`/`STAFF` vers `/admin` plutôt que vers l'espace client.
- **Types** : codes `ORDER_NOT_DELIVERED`, `ORDER_REFUNDED`, `ORDER_ALREADY_REFUNDED`,
  `CREDENTIAL_UNREADABLE`, `CREDENTIALS_IN_USE`, `PAYMENT_MODE_UNAVAILABLE`, `KYC_REVOKED` ;
  notifications `ORDER_DELIVERED` / `ORDER_REFUNDED`.

**Acceptation** : payer → livrer ✓ ; rembourser → révoquer l'accès ✓ ; non vérifié ne commande
pas ✓ ; double webhook sans double livraison ni double notification ✓ ; `pnpm -r lint` ✓.
Smoke API **24/24** (montant serveur, format `MD-AAAA-NNNNNN`, refus avant livraison, idempotence,
déchiffrement, garde KYC, recherche admin, refus motif court, double remboursement), **12/12**
(notifications), **8/8** (garde `INSTALLMENTS`, produits non publiés, quantités) et **44/44**
(identifiants produit : chiffrement au repos, absence de fuite en lecture, 403 client, audit
CRITICAL, rotation bloquée puis `force` + notification acheteur, refus de suppression après
livraison, mise en place tardive sur produit livré).

**Reste à faire (hors P6)** : le mouvement d'argent du remboursement reste une opération
opérateur (l'adaptateur PayTech n'expose que création + statut, pas de remboursement API) ; les
produits `paymentMode = INSTALLMENTS` sont **refusés** à la commande (`PAYMENT_MODE_UNAVAILABLE`,
bouton « Bientôt disponible ») tant que P7 n'a pas généré l'échéancier — on ne peut pas encaisser
la totalité d'un coup sans rompre l'engagement « entrée + N mensualités » affiché.

## Phase 7 — Échéanciers
- Plan + Installment, algorithme d'arrondi exact (docs/06§2), paiement d'échéance, rappels,
  OVERDUE/jobs, vue client complète (total/payé/restant/prochaine), gestion defaults admin.
- **Acceptation** : `down + Σ échéances == total` à fureur de génération ; détection overdue daily.

## Phase 8 — Dashboard administrateur ✅ (livrée)

**Console `/admin`** (layout client : garde `/auth/me`, sidebar filtrée par permissions, drawer
mobile) aux tokens Palette A, zéro dépendance graphique (SVG maison animé via `motion/react`).

- **Tableau de bord** : 8 KPIs (revenus, encaissé du jour, tranches à échoir 7 j, impayés en
  retard, clients, vendeurs actifs, commandes, dossiers KYC) avec compteurs animés + sparkline,
  courbe 30 j (tracé animé, tooltip au survol), donut KYC (segments animés, hover isolé),
  barres « origine des revenus », records top ventes / top produits, activité récente.
- **Clients** (perm `SUPPORT`) : liste filtrable (KYC, statut, recherche), fiche complète
  (contact, sessions, 2FA, commandes, total payé), suspension/bannissement avec motif tracé.
- **Vendeurs** (perm `SELLERS`) : liste (soldes, KYC, statut), fiche avec soldes,
  **documents KYC fournis** (4 tuiles signées), historique de vérification, actions de statut.
- **Paiements en tranches** (perm `PAYMENTS`) : plans avec barres d'avancement, modal
  échéancier, **encaisser une échéance** (« Encaisser »), **solder en une fois** (confirmation +
  référence), encaissements du plan. État via fixtures démo (`pnpm admin:fixtures`) en
  attente du vrai flux d'achat de P7.
- **Équipe** (perm `SETTINGS`) : managers STAFF — création/édition/suppression, **9 permissions
  granulaires** (case à cocher + description), **horaires hebdomadaires** (par jour, début/fin),
  coupe/réactivation d'accès. Schéma : `ManagerProfile` + `ManagerShift`.
- **Paramètres** (perm `SETTINGS`) : settings groupées, édition par type (int/string/bool),
  enregistrement unitaire tracé (`SETTINGS_CHANGE` WARNING).
- **Journal** (perm `SETTINGS`) : audit paginé (gravité, filtre action, dépliage metadata).
- **Guards API** : `requirePermission(...)` (ADMIN bypass, STAFF via profil) + `perm()` sur
  toutes les routes admin ; modules migrés (KYC/WITHDRAWALS/PAYMENTS/SETTINGS) ; codes d'erreur
  `SELF_ACTION`, `INVALID_STATE`, `INSTALLMENT_ALREADY_PAID`, `PLAN_NOTHING_TO_SETTLE`.
- **Acceptation** : tsc web/api 0 erreur ; les 9 routes `/admin/*` rendent 200 ; smoke API des
  mutations (collect 200, settle 200, create/delete manager 200) ; **captures authentifiées** de
  9 pages sans erreur console ; mutations testées depuis l'UI (encaisser, solder, créer manager,
  modifier un paramètre) — manager de test nettoyé, paramètres restaurés.
- **Reste en P11** : 2FA admin (non couverte ici).

## Phase 9 — Promotions & mise en avant
- CRUD promo (planification, prix/réduction), badge & prix calculé serveur ; achat mise en avant
  (balance/paytech), job d'expiration, liste admin.
- **Acceptation** : prix affiché en promo = facturé ; désactivation auto à expiration.

## Phase 10 — Support, messagerie, notifications
- Tickets + statuts + code d'aide, messagerie (avec interdiction Client↔Vendeur), centre notifs,
  préférences canaux, template emails (critiques), architecture push (mobile).
- **Acceptation** : une conversation Client↔Vendeur est impossible (test côté serveur) ;
  notifications critiques non désactivables.

## Phase 11 — Sécurité avancée
- Tests de pénétration : SQLi, XSS, CSRF, brute force, SSRF, élévation, prise de session,
  rate-limit, OWASP ASP, verrous sur écritures monétaires.
- **Acceptation** : rapport d'audit + corrigés ; vérif des guards de transition d'état.

## Phase 12 — Performances
- Cache HTTP/CDN, images (next/image, AVIF), minification, code splitting, index finaux, profilage
  SQL, préchargement des routes, audits Lighthouse (> 90 mobile) & ltème de charge.
- **Acceptation** : TTI cible & P75 150 ms ; zéro « requête N+1 » , COUNT(*) évités par pagination
  curseur.

## Phase 13 — Tests
- Test unitaire (services), intégration (testcontainers postgres), e2e (Playwright) sur les
  parcours §39, charge multi-utilisateurs findable (verrous, idempotence).
- **Acceptation** : couverture ≥ 70 % sur les services financiers ; CI verte.

## Phase 14 — Déploiement production
- Docker, CI/CD, Postgres managé + backups/PITR, stockage R2 chiffré, PayTech prod keys,
  SMTP + SMS prod, monitoring/alertes, domaines SSL, debug logs désactivés, durées de session
  admin finalisées, conformité conservation des données.
- **Acceptation** : runbook de restauration testé ; 12‑tech liters (isolation secrets, rotation).

---

## Dépendances inter-phases importantes
- **P5 (PayTech) est le goulot** : P6, P7, P4 (frais), P9 (mise en avant) dépensent le même
  pipeline. On développe donc **le service de paiement générique en premier au sein de P5** et
  chaque paiement aux phases suivantes n'utilise que ce service.
- La **livraison** (P6) dépend de P5 ; les **échéanciers** (P7) dépendent de P5+P6.
- Le design UI est dressé dès P3 ; les dashboards (P4/P8) suivent les tokens existants.

## Règles de non-régression transverses (lors de CHAQUE phase)
1. Aucun nombre métier codé en dur dans l'UI (vient de l'API).
2. Permission + possession vérifiées dans les services.
3. Paiements : jamais de crédit sans preuve serveur.
4. Sensibles : jamais exposés, jamais statiques, accès tracé.
5. Animations : performance d'abord.