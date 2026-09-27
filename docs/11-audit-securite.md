# 11 — Audit de sécurité (Phase 11 — pentest)

> Phase de référence : **P11 — Sécurité avancée** (`docs/08`, §22–§25, §64) ;
> périmètre : SQLi, XSS, CSRF, brute force, SSRF, élévation de privilèges, vol de session,
> rate-limit, OWASP, verrous sur les écritures monétaires.
>
> Référentiel de contrôle : `docs/05-securite.md` (sécurité by design),
> `docs/04-roles-permissions.md` (RBAC), `docs/06-paiements.md` (transitions monétaires).
>
> Méthode : **revue de code ciblée + sondes no-boîte sur instance locale** (API `http://127.0.0.1:4000`).
> Aucune donnée réelle manipulée, aucune écriture hors périmètre de test, lecture seule en base.
> Sécrets : non reproduits ici (valeurs masquées, préfixes uniquement).

---

## 1. Contexte & méthodologie

| Élément | Valeur |
|---|---|
| Cible | API Fastify 5 (`apps/api`) + front Next.js (`apps/web`) |
| Instance testée | `http://127.0.0.1:4000/api/v1` (port secondaire `4010` pour les re-tests de correctifs) |
| Base | PostgreSQL `misterdou` (docker `misterdou-postgres`) — **lecture seule** |
| Identité de test | `smoke-client@test.local` (rôle CLIENT) + compte admin TOTP existant |
| Outils | `curl` (sondes HTTP), `psql` (inventaire & vérification), revue de source |
| Normes | OWASP Top 10 (2021), OWASP ASVS L1/L2, OWASP API Security Top 10 |

**Déroulement**

1. Inventaire exhaustif des routes (`apps/api/src/modules/**/routes.ts`) et cartographie des gardes
   (`requireAuth`, `requirePermission`, `requireAdminSession`, `preHandler`).
2. Revue ciblée des familles de vulnérabilités demandées (SQLi, XSS, CSRF, IDOR, SSRF, RBAC,
   sessions, monnaie).
3. Sondes d'exécution (section 5) sur une instance réelle, avant correction.
4. Corrections P0/P1/P2 (section 6), puis **re-tests de non-régression** sur une seconde instance.
5. Vérification statique (`tsc --noEmit`) sur `@misterdou/api` et `@misterdou/web`.

**Hors périmètre** (non couvert par cette phase) : pentest externe black-box, fuzzing, test de
charge, audit SCA/dépendances, revue d'infrastructure, test de pénétration réseau.

---

## 2. Synthèse

| Gravité | Définition | Total | Corrigés | Non traités (volontaire) |
|---|---|---|---|---|
| **P0 — Critique** | Exploitation directe non authentifiée, perte d'argent ou de données | **0** | 0 | 0 |
| **P1 — Élevé** | Élévation de privilèges ou contournement de contrôle d'accès | **3** | 3 | 0 |
| **P2 — Moyen** | Affaiblissement d'un contrôle (brute force, exposition, atomicité) | **4** | 4 | 0 |
| **P3 — Faible** | Défaut robustesse / écart de spécification, sans exploitation directe | **5** | 1 | 4 |
| **Total** | | **12** | **8** | **4** |

**Aucune vulnérabilité critique (P0)** identifiée. Les trois constats P1 touchent au contrôle
d'accès (RBAC + sessions) ; ils étaient tous trois exploitables par un compte interne
(STAFF/SETTINGS) ou après suspension d'un compte.

Points forts vérifiés : aucune injection SQL (Prisma paramétré, zéro `$queryRaw` interpolé),
aucun XSS côté client (React + CSP), CSRF double-submit systématique, webhook PayTech signé
(HMAC + fenêtre de tolérance), transitions monétaires verrouillées par `updateMany` à état
conditionnel, secrets absents du dépôt (`.env` gitignoré, vérifié par `git check-ignore`).

---

## 3. Constats

### V-01 — Réécriture/expo­sition des secrets MFA internes via l'API Settings — **P1 — corrigé**

- **CWE** : CWE-732 (incorrect permission assignment) · **OWASP** : A01 Broken Access Control
- **Emplacement (avant)** : `apps/api/src/modules/admin-ops/service.ts` (`listSettings`, `updateSetting`),
  route `PATCH /api/v1/admin/settings/:key`.
- **Constat** : les secrets TOTP des administrateurs sont stockés en base comme des Settings
  (clé `adminTotpSecret:<userId>`). L'API de paramètres les exposait en lecture
  (`listSettings` sans filtre) **et** les acceptait en écriture (`updateSetting` sans garde).
- **Impact** : un opérateur doté de la permission `SETTINGS` (plusieurs profils STAFF en ont
  toutes) pouvait **lire le second facteur d'un administrateur** ou **le réécrire** (rendre la
  MFA inutilisable / la neutraliser à son profit). Compromission de la 2FA de l'ADMIN.
- **Correction** : filtre `startsWith(INTERNAL_SETTINGS_PREFIX)` à la lecture
  (`service.ts:72`), rejet à l'écriture (`service.ts:81`), constante exportée `service.ts:19`.

### V-02 — Gestion des rôles/permissions accessible aux non-ADMIN — **P1 — corrigé**

- **CWE** : CWE-269 (Improper Privilege Management) · **OWASP** : A01
- **Emplacement (avant)** : `apps/api/src/modules/admin-ops/routes.ts` —
  `PATCH /admin/settings/:key`, `POST /admin/managers`, `PATCH /admin/managers/:id`,
  `DELETE /admin/managers/:id` protégés par `permissionGuard("SETTINGS")`.
- **Constat** : `docs/04` réserve « Modifier les Settings » et « Gérer les rôles » à **ADMIN**.
  Or un STAFF `SETTINGS` pouvait : créer un compte avec le tableau de permissions arbitraire
  (`createManager` → `permissions: input.permissions`), **redonner des permissions à son propre
  profil** (`updateManager` auto-cible) et **se supprimer/suspendre lui-même**
  (`deleteManager` auto-cible).
- **Impact** : escalade horizontale et verticale interne (KYC, retraits, audit, SETTINGS)
  à partir d'un simple compte staff.
- **Correction** :
  - routes basculées sur `adminGuard` (`routes.ts:68`, appliqué aux lignes `95`, `126`, `138`, `149`) ;
  - verrous métier : `updateManager` (`service.ts:232-234`) et `deleteManager` (`service.ts:292-294`)
    refusent l'auto-modification quand `actor.actorRole !== "ADMIN"`.

### V-03 — Session encore valide après suspension/suppression du compte — **P1 — corrigé**

- **CWE** : CWE-613 (Insufficient Session Expiration) · **OWASP** : A07
- **Emplacement (avant)** : `apps/api/src/lib/sessions.ts` (`findActiveSessionInternal`).
- **Constat** : la session était recherchée uniquement par hash de `sid` ; le statut de l'utilisateur
  (`SUSPENDED`, `BANNED`, `deletedAt`) n'était pas vérifié. Une session ouverte restait donc
  utilisable jusqu'à expiration (**30 jours**, `SESSION_TTL_SECONDS=2592000`) après suspension,
  bannissement ou suppression logique du compte — y compris en cours d'incident de sécurité.
- **Impact** : la procédure de révocation (docs/05 §1.2 « révocation immédiate ») n'avait aucun
  effet sur les sessions existantes.
- **Correction** : `sessions.ts:60` — `if (session.user.status !== "ACTIVE" || session.user.deletedAt !== null) return null`.

### V-04 — Pas de rate-limit sur les points d'entrée MFA/OTP — **P2 — corrigé**

- **CWE** : CWE-307 (Improper Restriction of Excessive Auth Attempts) · **OWASP** : A07
- **Emplacement (avant)** : `apps/api/src/modules/auth/routes.ts`.
- **Constat** : `POST /auth/admin/totp/setup`, `POST /auth/admin/totp/confirm` et
  `POST /auth/phone` n'avaient **aucune** limite de débit (contrairement à `/auth/login` = `rate(5)`).
  `totp/confirm` accepte un code à 6 chiffres : sans limite IP, l'attaque par force brute reste
  réduite à la fenêtre TOTP, mais sans coût côté attaquant.
- **Correction** : `config: rate(5)` sur les trois routes (`routes.ts:95`, `:100`, `:150`).

### V-05 — Pas de rate-limit sur les endpoints monétaires — **P2 — corrigé**

- **CWE** : CWE-770 (Allocation of Resources Without Limits) · **OWASP** : API4 Unrestricted Resource Consumption
- **Constat** : les routes créatrices/consultatrices de paiement étaient sans limite de débit :
  `GET /payments/:token` (déclenche `settlePayment`, écriture monétaire),
  `POST /payments/:token/checkout`, `POST /orders`, `POST /orders/:id/installments/pay`,
  `POST /products/:id/featured`, `POST /support/tickets`, `POST /conversations`,
  `POST /uploads` (8 Mo), `POST /kyc`.
- **Impact** : abus de l'interopérabilité de tokens de paiement, création massive de commandes/
  tickets/fichiers, pression sur le pipeline de règlement.
- **Correction** (planchers) :

  | Route | Limite | Fichier |
  |---|---|---|
  | `GET /payments/:token` | 30/min | `payments/routes.ts:66` |
  | `POST /payments/:token/checkout` | 10/min | `payments/routes.ts:79` |
  | `POST /orders` | 10/min | `orders/routes.ts:32` |
  | `POST /orders/:id/installments/pay` | 10/min | `installments/routes.ts:70` |
  | `POST /products/:id/featured` | 10/min | `promotions/routes.ts:136` |
  | `POST /support/tickets` | 10/min | `support/routes.ts:95` |
  | `POST /conversations` | 10/min | `messaging/routes.ts:160` |
  | `POST /uploads` | 20/min | `identity-verification/routes.ts:28` |
  | `POST /kyc` | 5/min | `identity-verification/routes.ts:48` |

### V-06 — Compteur OTP non atomique (contournement en parallèle) — **P2 — corrigé**

- **CWE** : CWE-362 (Race Condition) · **OWASP** : A04 Insecure Design
- **Emplacement** : `apps/api/src/modules/auth/service.ts` (`verifyOtp`).
- **Constat** : les tentatives étaient lues (`otpAttempts`) puis réécrites après échec
  (`update +1`). Deux requêtes parallèles pouvaient toutes deux lire la même valeur et consommer
  plus de 3 tentatives réelles.
- **Correction** : réclamation atomique **avant** la vérification —
  `updateMany({ where: { id, status:"PENDING", otpAttempts: { lt: OTP_MAX_ATTEMPTS } }, data: { otpAttempts: { increment: 1 } } })`
  (`service.ts:219-221`) ; `count === 0` → `OTP_TOO_MANY_ATTEMPTS`. Le code n'est jamais révélé
  côté client (message générique conservé).

### V-07 — Plan d'API Swagger exposé par défaut en production — **P2 — corrigé**

- **CWE** : CWE-200 (Exposure of Sensitive Information) · **OWASP** : A05 Security Misconfiguration
- **Constat** : `@fastify/swagger` + `-ui` étaient enregistrés inconditionnellement →
  `GET /docs` publie la totalité des routes (y compris `/admin/*`, `/webhooks/*`) et leurs schémas.
  `index.ts:15` affiche d'ailleurs l'URL des docs au démarrage.
- **Correction** : `apps/api/src/env.ts:44` (`SWAGGER_ENABLED: "true" | "false"`) et
  `apps/api/src/app.ts:92-95` — enregistrement conditionnel, **défaut sûr** :
  ouvert en dev/test, **fermé en production** sauf activation explicite.
  L'affichage de l'URL `/docs` à l'entrée suit le même drapeau (`app.ts:142`).

### V-08 — Erreurs 4xx renvoyées en `500 INTERNAL_ERROR` (+ message du parser JSON) — **P3 — corrigé**

- **CWE** : CWE-755 (Improper Handling of Exceptional Conditions)
- **Constat (avant)** : les erreurs internes Fastify n'étaient pas reconnues par le handler
  global → retombe dans la branche générique 500 :
  - `GET /api/catalogue?sort=<valeur inconnue>` → **500** (devrait être 400, rejet de schéma) ;
  - corps JSON malformé → **500** avec `details` contenant le **message brut du parser**
    (reflet du corps envoyé) en développement ;
  - corps > 2 Mo → **500** (devrait être 413).
- **Impact** : faux positifs d'erreur serveur (bruit d'alerte, masquage des vrais 5xx),
  divergence du contrat d'erreur `{ ok:false, error:{code} }`, fuite de message parser.
- **Correction** :
  - `apps/api/src/lib/error-handler.ts:55-98` — branche dédiée pour les codes/status 4xx Fastify
    (`FST_ERR_VALIDATION`, `FST_ERR_CTP_*`, `FST_ERR_RATE*`) → 400/413/429 + codes métier ;
  - `apps/api/src/app.ts:65-78` — le parser JSON custom n'propage plus le `SyntaxError` brut
    (erreur neutralisée `JSON invalide` + `statusCode: 400`).

### V-09 — CSRF vérifié avant authentification — **P3 — non traité**

Toute mutation `/api/v1` sans cookie `md_csrf` renvoie `403 FORBIDDEN "Jeton CSRF invalide ou
absent"` **avant** toute vérification d'identité : un appel non authentifié obtient 403 au lieu de
401, et un client « Bearer only » (futur mobile, docs/05 §1.2) doit d'abord récupérer le cookie
CSRF (`GET /auth/me`). Non corrigé : comportement double-submit assumé, sans faille (le cookie
n'est pas lisible cross-origin, `SameSite=Lax` + `HttpOnly` sur `md_sid`).

### V-10 — Pas de contrainte DB sur l'« apport » d'un échéancier — **P3 — non traité**

`applyDownPayment` (`installments/service.ts:187-208`) calcule `alreadyCounted` par lecture puis
écriture dans la transaction. Deux paiements `INITIAL_INSTALLMENT` distincts pour un même plan
(race entre création client et `settlePlan` admin) pourraient être comptés deux fois.
Non corrigé : nécessite une **contrainte unique en base**, hors périmètre (interdiction de toucher
`packages/db/prisma/schema.prisma`). Recommandation : index unique partiel
`(installmentPlanId) WHERE type='INITIAL_INSTALLMENT'`.

### V-11 — Allow-list IP du webhook PayTech inactive par défaut — **P3 — non traité**

`PAYTECH_WEBHOOK_SECRET` est défini (signature HMAC vérifiée : **401 sans/bad signature**, fenêtre
de tolérance temporelle refusée), mais `PAYTECH_WEBHOOK_IPS` n'est pas défini → l'allow-list IP
est désactivée. Non corrigé (variable d'environnement) : **à renseigner en production**.
La signature HMAC reste la barrière principale.

### V-12 — Expositions de dev : `/docs` et `/api/seed` — **P3 — non traité (sans risque)**

- `GET /api/seed` : **lecture seule** (inventaire du catalogue de test), aucune écriture,
  aucun P0 — laissé tel quel.
- `GET /docs` : fermé en prod via V-07.
- Écart documentaire mineur : `docs/05 §2` annonce `X-Frame-Options: DENY`, helmet renvoie
  `SAMEORIGIN` ; la CSP `frame-ancestors 'none'` est déjà plus stricte → sans risque.

---

## 4. Verrous sur les écritures monétaires — vérification

Toutes les transitions monétaires utilisent un **`updateMany` à état conditionnel**
(`where { statut attendu }`, `count === 0` → `conflict`) **à l'intérieur** d'une transaction :
une rejeu ou une concurrence ne peut pas re-passer l'état.

| Transition | Garde | Verdict |
|---|---|---|
| `settlePayment` : `PENDING/PROCESSING → SUCCESS` | `updateMany` conditionnel + effet `count===0` → abort | ✅ idempotent |
| `deliverOrderAfterSuccess` | `updateMany deliveredAt: null` → non ré-itérable, saute si `REFUNDED` | ✅ |
| Approbation d'un retrait | `updateMany status: "PENDING"` dans `tx` | ✅ double-validation impossible |
| Rejet d'un retrait | idem | ✅ |
| Débit solde (mise en avant) | `updateMany balanceAvailable gte montant` | ✅ pas de solde négatif |
| `refundPayment` | `updateMany status: "SUCCESS" → REFUNDED` + re-crédit featured/balance | ✅ |
| Échéances (`applyInstallmentPayment`) | idempotence `PAID/WAIVED` + recalcul par `aggregate(SUCCESS)` (pas d'incrément aveugle) | ✅ |
| Révélation des identifiants eFootball | propriétaire + `order.status = DELIVERED` + non `REFUNDED` | ✅ |
| Démarrage d'un plan | `downSettled`/paiement en cours vérifiés avant création | ⚠️ voir V-10 |

Aucune faille P0 trouvée sur la monnaie. Rejeux testés (double `settle`, double approbation)
sans régression observée.

---

## 5. Sondes exécutées (avant → après)

Toutes les commandes sont des requêtes locales sur l'instance de test ; les tokens/UUID sont
fictifs ou issus du compte de test.

| # | Vecteur | Cible | Résultat observé | Statut |
|---|---|---|---|---|
| S01 | SQLi (OR 1=1 / DROP TABLE) | `GET /api/catalogue?division=' OR 1=1--`, `q='; DROP TABLE users;--` | 200, jeu de données normal, aucun schéma exposé | ✅ non exploitable |
| S02 | SQLi sur curseur | `GET /conversations/<uuid>/messages?before=' OR 1=1--` | 404 `Conversation introuvable` | ✅ |
| S03 | Accès non authentifié | `GET /api/v1/admin/overview`, `/admin/audit`, `/admin/kyc` | 401 `UNAUTHORIZED` | ✅ |
| S04 | Élévation CLIENT → ADMIN | `PATCH /admin/settings/currency` (session CLIENT) | 403 `FORBIDDEN` | ✅ |
| S05 | RBAC interne (avant) | routes `Settings`/`Managers` avec permission `SETTINGS` non-ADMIN | **autorisées** (V-01/V-02) | ❌ → **corrigé**, désormais 403 via `adminGuard` |
| S06 | Secrets MFA exposés | `GET /admin/settings` (liste contenant `adminTotpSecret:*`) | **retournés en clair** | ❌ → **corrigé** (filtre) |
| S07 | CSRF absent | `POST /api/v1/support/tickets` sans header `x-csrf-token` | 403 `Jeton CSRF invalide ou absent` | ✅ |
| S08 | CSRF valide | idem **avec** header + cookie `md_csrf` | 200, ticket créé | ✅ |
| S09 | IDOR commande (cross-user) | `GET /orders/<uuid d'un autre utilisateur>` | 404 (pas de divulgation) | ✅ |
| S10 | IDOR révération credentials | `GET /orders/<uuid>/reveal` (autre utilisateur) | 404 | ✅ |
| S11 | IDOR ticket support | `GET /support/tickets/<uuid inconnu>` | 404 | ✅ (voir §7 — pas de 2ᵉ compte réel) |
| S12 | Absence de session | `GET /api/v1/orders/mine` sans cookie | 401 `UNAUTHORIZED` | ✅ |
| S13 | Séparation sessions admin | `GET /auth/admin/me` avec session CLIENT | 403 `FORBIDDEN` | ✅ |
| S14 | Brute force connexion | 7× `POST /auth/login` mauvais mot de passe | 400 ×5 puis **429** `RATE_LIMITED`; récupération constatée après 62 s | ✅ |
| S15 | Brute force MFA (avant) | `POST /auth/admin/totp/confirm` | **aucune limite** | ❌ → **corrigé** `rate(5)` |
| S16 | Brute force OTP (parallèle) | compteur `otpAttempts` read-then-write | **non atomique** | ❌ → **corrigé** `updateMany` |
| S17 | Webhook sans signature | `POST /api/v1/webhooks/paytech` (vide) | 401 `Signature invalide` | ✅ |
| S18 | Webhook signature fausse | + timestamp hors fenêtre | 401 | ✅ |
| S19 | Webhook corps malformé | JSON cassé | 400 (après V-08 : 400, avant : 500) | ✅ |
| S20 | SSRF | aucun `fetch`/`http.request` sur URL utilisateur (URL PayTech en env) | surface nulle | ✅ |
| S21 | XSS stocké/reflet | `dangerouslySetInnerHTML` absent, CSP `default-src 'self'` | aucune occurrence | ✅ |
| S22 | `/docs` exposé | `GET /docs` | 200 en dev **et** en prod (avant) | ❌ → **corrigé** (fermé en prod) |
| S23 | Rejet de schéma | `GET /api/catalogue?sort=badvalue` | **500** `INTERNAL_ERROR` | ❌ → **corrigé** 400 |
| S24 | Corps JSON invalide | `POST /auth/login -d "not-json"` | **500** + message parser en `details` | ❌ → **corrigé** 400 générique |
| S25 | Corps trop volumineux | `POST /auth/login` corps > 2 Mo | **500** | ❌ → **corrigé** 413 |
| S26 | Contenu type invalide | `POST /auth/login` `Content-Type: text/plain` | 400 `VALIDATION_ERROR` | ✅ |
| S27 | Débit checkout (avant) | `GET /payments/:token` × 33 | 404 ×33 (aucune limite) | ❌ → **corrigé** : 404 ×30 puis **429** |
| S28 | Débit création de commande | `POST /orders` × 12 | avant : aucune limite ; après : 403 ×10 puis **429** | ✅ corrigé |
| S29 | Débit OTP téléphone | `POST /auth/phone` × 6 | avant : aucune limite ; après : 403 ×5 puis **429** | ✅ corrigé |
| S30 | Enumération / pagination abusive | `GET /api/catalogue?page=999999999999` | 200, réponse bornée | ✅ |
| S31 | Exposition de stack trace | réponses 4xx/5xx | aucune stack, enveloppe `{ok:false,error:{code,message}}` | ✅ |
| S32 | Fuite de secrets en dépôt | `git ls-files \| grep .env`, `git check-ignore` | `.env` ignorés, aucun tracké | ✅ |
| S33 | Cookies de session | `Set-Cookie` observés | `md_sid` : `HttpOnly; SameSite=Lax` (+ `Secure` en prod), `md_csrf` lisible en JS (double-submit) | ✅ |
| S34 | Headers de sécurité | `GET /health` | CSP stricte, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, COOP/CORP, `cache-control: no-store` | ✅ |
| S35 | Exposition d'erreur monétaire | `GET /payments/mdpay_faketoken` | 404 (pas de différenciation token valide/invalide) | ✅ |

---

## 6. Corrections appliquées (fichiers & lignes)

| Fichier | Lignes | Correction |
|---|---|---|
| `apps/api/src/modules/admin-ops/service.ts` | 19, 68-75, 77-81 | Constante `INTERNAL_SETTINGS_PREFIX`, exclusion des secrets MFA à la lecture, rejet à l'écriture (V-01) |
| `apps/api/src/modules/admin-ops/service.ts` | 232-234, 292-294 | Interdiction de modifier/supprimer son propre accès si non-ADMIN (V-02) |
| `apps/api/src/modules/admin-ops/routes.ts` | 68, 95, 126, 138, 149 | `adminGuard` (session ADMIN) sur Settings + Managers (V-02) |
| `apps/api/src/lib/sessions.ts` | 60 | Rejet des sessions d'un compte non-`ACTIVE`/supprimé (V-03) |
| `apps/api/src/modules/auth/routes.ts` | 95, 100, 150 | `rate(5)` sur `totp/setup`, `totp/confirm`, `phone` (V-04) |
| `apps/api/src/modules/auth/service.ts` | 215-228 | Réclamation atomique des tentatives OTP (V-06) |
| `apps/api/src/modules/payments/routes.ts` | 66, 79 | 30/min sur `GET /payments/:token`, 10/min sur checkout (V-05) |
| `apps/api/src/modules/orders/routes.ts` | 32 | 10/min sur `POST /orders` (V-05) |
| `apps/api/src/modules/installments/routes.ts` | 70 | 10/min sur règlement d'échéance (V-05) |
| `apps/api/src/modules/promotions/routes.ts` | 136 | 10/min sur `POST /products/:id/featured` (V-05) |
| `apps/api/src/modules/support/routes.ts` | 95 | 10/min sur ouverture de ticket (V-05) |
| `apps/api/src/modules/messaging/routes.ts` | 160 | 10/min sur création de conversation (V-05) |
| `apps/api/src/modules/identity-verification/routes.ts` | 28, 48 | 20/min uploads, 5/min soumission KYC (V-05) |
| `apps/api/src/env.ts` | 44 | `SWAGGER_ENABLED` (V-07) |
| `apps/api/src/app.ts` | 92-108, 142 | Swagger conditionnel, défaut fermé en production (V-07) |
| `apps/api/src/app.ts` | 65-78 | Parser JSON : erreur neutralisée 400 (V-08) |
| `apps/api/src/lib/error-handler.ts` | 55-98 | Mapping des erreurs Fastify 4xx → 400/413/429 (V-08) |

---

## 7. Non traité volontairement & recommandations

1. **V-10** — Contrainte DB unique sur l'apport d'un échéancier (nécessite une migration Prisma,
   hors périmètre de cette phase).
2. **V-11** — Renseigner `PAYTECH_WEBHOOK_IPS` en production (ranges PayTech).
3. **V-09** — Ordre des hooks CSRF/auth : si un futur client Bearer arrive, ajouter une exemption
   « pas de cookie → pas de CSRF » ou exiger un header `Origin` en complément.
4. **Deux comptes réels** : aucun couple de comptes authentifiés simultanément n'était disponible
   pour une **preuve IDOR positive** ; l'absence de divulgation est donc établie par 404 sur UUID
   forgés **et** par revue de code (`where` systématique sur `actor`/`owner`) — à refaire avec deux
   comptes en phase de tests (P13).
5. **Tilt/timing** : `login` renvoie une erreur unique et uniforme (énumération neutralisée) ;
   aucun délai artificiel n'est ajouté — acceptable en dev, à réévaluer en prod sous charge
   (rate-limit IP déjà en place).
6. **`adminTotpSecret:*`** : à terme, migrer ce secret hors de `Settings` (table dédiée ou KMS)
   plutôt que de le protéger par filtre applicatif.
7. **Sessions `md_sid`** : TTL client 30 jours — prévoir une révocation « tous les appareils »
   côté compte (déjà partiellement présent) et rotation du `sid` après changement de mot de passe.

---

## 8. Vérifications

| Commande | Résultat |
|---|---|
| `pnpm --filter @misterdou/api typecheck` | ✅ `tsc --noEmit` — 0 erreur |
| `pnpm --filter @misterdou/web typecheck` | ✅ `tsc --noEmit` — 0 erreur |
| Re-tests S19, S23, S24, S25, S27, S28, S29 sur instance secondaire | ✅ comportements attendus |
| Non-régression : `GET /health`, `POST /auth/login`, `GET /api/catalogue`, webhook PayTech | ✅ 200/401/400 |

> **Écoute** : l'API de test sur le port 4000 n'a pas été redémarrée ; les re-tests de
> correctifs ont été menés sur une seconde instance (`API_PORT=4010`) pour préserver
> l'environnement de travail.
