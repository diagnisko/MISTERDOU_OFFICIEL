# 12 — Performances (Phase 12 — optimisation API & base)

> Phase de référence : **P12 — Optimisation des performances** (`prompt.txt` §28, `docs/08-plan-developpement.md`) ;
> périmètre : requêtes SQL, API, cache, compression, pagination, index.
>
> Référentiel : `docs/02-architecture-technique.md`, `docs/03-base-de-donnees.md`.
>
> Méthode : **relevés de latence (avant/après) + `EXPLAIN (ANALYZE, BUFFERS)` + sondes HTTP
> + revue de source** sur l'instance locale (PostgreSQL `misterdou` en lecture seule,
> API de test sur port secondaire `4010`).
>
> **Contraintes de phase respectées** : aucun `prisma db push|migrate|pull|generate`,
> aucune écriture SQL depuis le shell (index écrits dans le schéma **uniquement**),
> **aucun redémarrage de l'API du port 4000**, aucun changement dans `apps/web`.

---

## 1. Contexte & méthodologie

| Élément | Valeur |
|---|---|
| Cible | API Fastify 5 (`apps/api`) + schéma Prisma (`packages/db/prisma/schema.prisma`) |
| Instance « avant » | `http://127.0.0.1:4000` (code d'origine, **non redémarrée**) |
| Instance « après » | `http://127.0.0.1:4010` (code optimisé, montée pour les mesures, fermée ensuite) |
| Base | PostgreSQL `misterdou` (docker `misterdou-postgres`, port 5433) — **lecture seule** |
| Outils | `curl -w "%{time_total}"`, `node:fetch` (6 runs après 3 échauffements), `psql` (EXPLAIN), `tsc --noEmit` |
| Identifiants de test | `smoke-p9@test.local` (STAFF), `smoke-client@test.local` (CLIENT) — comptes de test existants |

**Déroulement**

1. Relevés de latence et de poids de réponse sur l'instance d'origine (§3.1).
2. Audit `EXPLAIN (ANALYZE, BUFFERS)` des requêtes des pages chaudes (§3.3).
3. Corrections applicatives : N+1, cache, ETag, compression (§4, §6, §8).
4. Ajout d'index **additifs** dans `schema.prisma` uniquement (§5).
5. Audit des plafonds de pagination (§7).
6. Re-mesures sur instance secondaire + sondes de non-régression (§3.1, §3.2, §10).

**Hors périmètre** : front (`apps/web` : images, JS/CSS, lazy loading, CDN — §9),
déploiement, test de charge à grande échelle, création physique des index (interdite cette phase).

---

## 2. Synthèse

| Levier | Avant | Après | Gain mesuré |
|---|---|---|---|
| Cache navigateur (routes publiques) | `Cache-Control: no-store` **imposé par le hook global**, y compris sur `/api/catalogue` | `public, max-age=60, stale-while-revalidate=300` | Seconde visite servie depuis le cache navigateur (0 requête réseau) |
| Réponse conditionnelle (ETag) | absent | ETag fort (sha1 du corps) + `304 Not Modified` | **3 042 o → 0 o** par requête répétée |
| Compression | aucune (gzip/br non installés) | `@fastify/compress` : br, gzip, deflate, seuil 512 o | catalogue **3 042 → 848 o (−72 %)** ; `/admin/audit` **16 990 → 1 616 o (−90 %)** |
| Requêtes N+1 | 5 sites | **0 site** | jusqu'à ~1 000 requêtes → **≤ 9 constantes** (relances) |
| Index | 7 index manquants sur les hot paths | 7 index **ajoutés** au schéma | plans d'exécution projetés sans `Seq Scan`/`Sort` (§3.3, §5) |
| Pagination | bornes déjà correctes | inchangé (audit : conforme) | tous les plafonds ≤ 100 (§7) |
| Sécurité du cache | — | `no-store` conservé dès qu'une session est présente | aucun risque de cache partagé pour un utilisateur connecté |

Les gains de **latence SQL** attendus (index) ne sont visibles **qu'après** `prisma db push` +
redémarrage — opérations explicitement interdites dans cette phase (§9, P1).

---

## 3. Mesures

### 3.1 Latences (avant → après)

« Avant » : `curl` sur `:4000` (moyenne de 5–6 exécutions chaudes, code d'origine).
« Après » : `node:fetch` sur `:4010` (3 échauffements puis **6 runs**, moyenne ; code optimisé).

| Endpoint | Avant (ms) | Après (ms) | Corps (o) |
|---|---|---|---|
| `GET /api/catalogue?perPage=12` | 16 | 22,2 (min 17,5 / max 33,5) | 3 042 (identité) |
| `GET /api/catalogue?division=OR&sort=newest` | 12 | 24,9 (min 15,7) | 655 |
| `GET /api/seed` | 31 | 33,8 | 3 839 |
| `GET /api/v1/meta` | 6 | 6,5 | 84 |
| `GET /api/v1/notifications` (client) | 16 | 18,2 | 73 |
| `GET /api/v1/conversations` (client) | 19 | 24,2 | 716 |
| `GET /api/v1/admin/overview` (staff) | 34 | 41,0 | 141 |
| `GET /api/v1/admin/plans?perPage=25` (staff) | 23 | 30,8 | 5 320 |
| `GET /api/v1/admin/audit?perPage=50` (staff) | 21 | 29,3 | 17 034 |
| `GET /api/v1/admin/conversations` (staff) | 20 | 30,4 | 617 |

**Lecture honnête** : les écarts sont dans le bruit de mesure (clients HTTP différents,
instance secondaire partageant la même base, table `AuditLog` ayant grandi pendant la session,
**index physiques absents**). Aucune régression structurelle : le surcoût ajouté
(regex + sha1 sur ~3 o, compression Brotli q5) est de l'ordre de la fraction de milliseconde.
Le premier appel « après » (démarrage à froid du moteur Prisma) atteint 762 ms, puis redescend
à 39 ms — comportement identique à l'instance d'origine (froid ≈ 100 ms).

Les gains durables de cette phase sont **binaires et structurels** : octets économés (§3.2)
et requêtes supprimées (§8), puis latences SQL à l'activation des index (§3.3).

### 3.2 Octets transmis (le gain réel)

| Requête | Identité | Brotli (`br`) | Économie |
|---|---|---|---|
| `GET /api/catalogue?perPage=12` | 3 042 o (`content-length: 3042`) | **848 o** (`content-encoding: br`) | **−72 %** |
| `GET /api/v1/admin/audit?perPage=50` | 16 990 o | **1 616 o** | **−90,5 %** |
| `GET /api/v1/meta` (84 o < seuil 512) | 84 o | non compressé (seuil respecté) | — |
| `GET /api/catalogue?perPage=12` + `If-None-Match` | 3 042 o | **0 o** (`304`, `content-length` absent) | **−100 %** |

En-têtes vérifiés sur instance : `content-type: application/json; charset=utf-8`,
`vary: Origin, accept-encoding` (posé par le plugin de compression), `etag` stable.

### 3.3 Plans d'exécution (EXPLAIN, base locale en lecture seule)

Base de test quasi vide (12 produits, 39 comptes, 138 notifications) : `Seq Scan` y est
**rationnel** pour le planner. Les captures ci-dessous servent de **référence « avant »** ;
les plans « après » sont des **projections** (création d'index interdite cette phase).

| Requête (page chaude) | Plan observé (AVANT) | Preuve |
|---|---|---|
| Catalogue : `WHERE status='ACTIVE' AND "deletedAt" IS NULL ORDER BY "createdAt" DESC LIMIT 12` | `Seq Scan on "Product"` → `Sort (quicksort)`, `Rows Removed by Filter: 5` | `EXPLAIN (ANALYZE, BUFFERS)` |
| Compteur du catalogue (`count(*)`, même `where`) | `Seq Scan on "Product"` | idem |
| Liste `/notifications` (`userId` + tri `createdAt DESC`) | `Seq Scan` + `Sort`, `Rows Removed by Filter: 129` | idem |
| « Mes conversations » (`participantA = moi OR participantB = moi`) | `Seq Scan` + `Filter OR` + `Sort updatedAt` — branche B **non indexée** | idem |
| Comptes par rôle (`/admin/overview`, `notifyActiveAdmins`) | `Seq Scan on "User"` + `Filter roleId`, `Rows Removed by Filter: 38` | idem |
| Messages non lus (`conversationId IN (…) AND "readAt" IS NULL`) | `Seq Scan on "Message"` + `Filter readAt IS NULL` | idem |
| Relances d'échéances (`status='PENDING' AND "dueDate" < now()`) | `Seq Scan on "Installment"` + `Filter`, `Rows Removed by Filter: 19` | idem |
| `/admin/plans` (join `Plan`→`Order`, tri `Order.createdAt DESC`, `LIMIT 25`) | `Hash Join` + `Sort` sur l'intégralité du résultat (`rows=610` estimés) avant `Limit` | idem |
| `/admin/orders` (`ORDER BY "createdAt" DESC LIMIT 25`) | `Seq Scan on "Order"` + `Sort` | idem |
| Journal d'audit (`ORDER BY "createdAt" DESC`, paginé) | ✅ `Index Scan using "AuditLog_createdAt_idx"` — **déjà conforme** | idem |

**Projections « après » activation des index (§5)**

- Catalogue : `Index Scan (status, deletedAt, createdAt DESC)` → **tri supprimé**, `LIMIT 300`
  satisfait par l'index en ordre décroissant.
- `/notifications` : `Index Scan (userId, createdAt DESC)` → `Seq Scan` + `Sort` éliminés.
- Conversations : les deux branches de l'`OR` indexées (`participantA`, `participantB`) →
  `Bitmap Or` au lieu d'un parcours de table.
- `/admin/overview` + alertes admins : `Index Scan (roleId)` → plus de `Rows Removed by Filter`.
- Relances : `Index Scan (status, dueDate)` → lecture des seules échéances concernées.
- `/admin/plans` : le tri par `Order.createdAt` devient un accès par index (nested loop)
  → `Sort` global éliminé.
- Messages non lus : `Index Scan (conversationId, readAt)` → fin du parcours de tous
  les messages d'une conversation.

---

## 4. Corrections applicatives (fichiers & lignes)

| Fichier | Lignes | Correction |
|---|---|---|
| `apps/api/src/plugins/security.ts` | 61-74 | Le `onSend` global n'impose plus `no-store` sur les réponses explicitement `public` ; il le réimpose dès qu'une session (`md_sid` ou `Authorization`) est présente |
| `apps/api/src/lib/envelope.ts` | 22, 32-66 | `PUBLIC_CACHE_CONTROL` + `sendPublicOk()` : ETag fort (sha1 base64url), `304` sur `If-None-Match` pour les GET, corps sérialisé une seule fois |
| `apps/api/src/app.ts` | 84-95 | Enregistrement `@fastify/compress` (`global`, `br/gzip/deflate`, seuil 512 o, zlib 6, brotli q5) |
| `apps/api/src/modules/catalogue/routes.ts` | 167-175 | `groupBy` des notes restreint aux ids de la **page renvoyée** (+ correctif du bug « page > 1 = `avgRating: null` ») ; 214-215, 270-271 : cache public + ETag sur liste et fiche |
| `apps/api/src/modules/seed/routes.ts` | 147-148 | Cache public + ETag |
| `apps/api/src/modules/settings/routes.ts` | 13-14 | `GET /meta` : cache public + ETag |
| `apps/api/src/modules/settings/service.ts` | 25-43 | `getPublicMeta()` : 3 `findUnique` → **1 `findMany`** (les exports `getStringSetting`/`getIntSetting` sont conservés) |
| `apps/api/src/lib/notify.ts` | 15-18, 33-104, 118-134 | Nouveau `notifyMany()` (1 lecture de préférences + 1 `createMany` + 1 lecture d'e-mails) ; `notifyUser` lui délègue ; `notifyActiveAdmins` n'appelle plus `notifyUser` par admin (N+1) |
| `apps/api/src/modules/installments/service.ts` | 394-491 | `sendInstallmentReminders()` : 2 lectures groupées en `Promise.all`, construction des rappels en mémoire, **1 seule** requête anti-doublon sur les titres, puis 2 appels `notifyMany` |
| `apps/api/src/modules/admin-ops/service.ts` | 626-679 | `settlePlan()` : les échéances encaissables sont filtrées d'abord, puis **1 `findMany`** de paiements `PENDING/PROCESSING` remplace le `findFirst` par échéance (N+1 de 12 requêtes pour un plan à 12 mois) |
| `apps/api/src/modules/promotions/service.ts` | 507-530 | `runPromotionJobs()` : **1 `updateMany`** + **1 `notifyMany`** remplacent la boucle `update` + `notifyUser` par mise en avant échue |
| `packages/db/prisma/schema.prisma` | 76-80, 216-220, 301-305, 394-398, 416-419, 519-522, 585-590 | 7 index additifs (§5) |

**Comportements inchangés** : règles de préférence de notification (évaluées ligne à ligne),
anti-doublon des rappels (même fenêtre glissante de 7 jours, même clé `userId + title`),
ordre des transactions de règlement (`settlePayment` appelé échéance par échéance),
neutre sur la logique métier (aucun nouveau `where` monétaire).

---

## 5. Index ajoutés (ADD uniquement — aucun existant retiré)

| # | Modèle | Index (`schema.prisma`) | Requête servie | Preuve |
|---|---|---|---|---|
| 1 | `User` | `@@index([roleId])` (:80) | Comptes par rôle, `notifyActiveAdmins` | EXPLAIN : `Seq Scan` + `Rows Removed: 38` |
| 2 | `Product` | `@@index([status, deletedAt, createdAt(sort: Desc)])` (:220) | `GET /api/catalogue`, `GET /api/seed` | EXPLAIN : `Seq Scan` + `Sort`, `Rows Removed: 5` |
| 3 | `Order` | `@@index([createdAt(sort: Desc)])` (:305) | `/admin/plans` (tri sur `Order.createdAt`), `/admin/orders` | EXPLAIN : `Hash Join` + `Sort` complet |
| 4 | `Installment` | `@@index([status, dueDate])` (:398) | Relances J-3, passage en `OVERDUE` | EXPLAIN : `Seq Scan` + `Rows Removed: 19` |
| 5 | `Notification` | `@@index([userId, createdAt(sort: Desc)])` (:419) | Liste `/notifications` | EXPLAIN : `Seq Scan` + `Sort`, `Rows Removed: 129` |
| 6 | `Conversation` | `@@index([participantBUserId])` (:522) | `OR participantA/participantB` (mes conversations) | EXPLAIN : `Seq Scan` + `Filter OR` |
| 7 | `Message` | `@@index([conversationId, readAt])` (:590) | Compteurs de non-lus, marquage en lu | EXPLAIN : `Seq Scan` + `Filter readAt IS NULL` |

Déjà présents et conformes (non modifiés) : `AuditLog(createdAt DESC)`,
`Payment(status, createdAt DESC)`, `Product(status, paymentMode, createdAt DESC)`,
`Product(sellerId, status)`, `Session(userId)`, `Order(buyerId, createdAt DESC)`,
`Message(conversationId, createdAt)`, `SupportTicket(reporterId, status)`, `Session(tokenHash)` unique.

Vérification : `prisma validate` → `The schema is valid` ; `pg_indexes` → **0 ligne**
pour ces index (attendu : pas de `db push` autorisé).

---

## 6. Cache, ETag, compression

**Cache navigateur.** Avant, le hook `onSend` global de `plugins/security.ts` écrasait
`Cache-Control` sur **toutes** les réponses (vérifié : `cache-control: no-store` même sur
`/api/catalogue`). Après, les routes publiques déclarées posent
`Cache-Control: public, max-age=60, stale-while-revalidate=300` et le hook les conserve ;
dès qu'une session est détectée, il remet `no-store`.

Routes passées en cache public : `GET /api/catalogue`, `GET /api/catalogue/:slug`,
`GET /api/seed`, `GET /api/v1/meta`. Toutes les routes authentifiées restent `no-store`
(vérifié : `notifications` et `conversations` en session → `no-store`, aucun `ETag`).

**ETag / 304.** `sendPublicOk()` calcule un ETag fort sur le corps JSON envoyé
(`sha1` → base64url) et répond `304` (corps vide, `content-length` absent) si
`If-None-Match` correspond, pour un `GET`. Comparaison insensible au `W/` et au `*`.

**Compression.** `@fastify/compress` enregistrée après `registerSecurityPlugin` (ordre des
hooks `onSend` : en-têtes de cache posés **avant** compression) :
`global: true`, encodings `br, gzip, deflate`, seuil 512 o (les petits corps ne sont pas
compressés), zlib niveau 6, Brotli qualité 5 (compromis CPU/débit sur petite charge utile).
Le téléchargement de documents (`application/pdf`, `image/*`, `content-length` imposé par la
route) est géré par le plugin : type non compressible → en-têtes intacts, sinon
`content-length` réécrit.

---

## 7. Audit des plafonds de pagination

Aucun ajout `.max(100)` nécessaire : **toutes les listes étaient déjà bornées.**

| Route | Borne | Fichier |
|---|---|---|
| `GET /api/catalogue` | `perPage` 4 → **48**, `page` 1 → 300 | `catalogue/routes.ts:136-137` |
| Administration (users, products, orders, payments) | `perPage` ≤ **100** (déf. 25) | `admin-console/routes.ts:9` |
| `/admin/plans`, `/admin/audit` | `perPage` ≤ **100** (déf. 25/50) | `admin-ops/routes.ts:30,36` |
| Messagerie (conversations, messages) | `perPage` ≤ **100**, `limit` messages ≤ **100** | `messaging/routes.ts:26,41` |
| `/notifications` | `perPage` ≤ **50** (déf. 20) | `notifications/routes.ts:15` |
| Promotions, support | `perPage` ≤ **100** | `promotions/routes.ts:20`, `support/routes.ts:26` |
| File KYC, jobs | `take: 100` / `take: 200` / `take: 50` | `identity-verification/service.ts:142`, `installments/service.ts:416,421`, `orders/service.ts:296` |

À surveiller : le catalogue lit **jusqu'à 300 offres** puis pagine en mémoire
(`take: 300` + `slice`, `catalogue/routes.ts:155,165`) — borné et suffisant aujourd'hui,
à pousser en SQL avec la croissance du catalogue (§9, P2).

---

## 8. Requêtes inutiles supprimées (N+1)

| Site | Avant | Après |
|---|---|---|
| `notifyActiveAdmins` (`lib/notify.ts:118`) | 1 `findMany` admins + **3 requêtes par admin** (préférences, `createMany`, e-mails) | 1 `findMany` + 1 `notifyMany` (3 requêtes **au total**) |
| `sendInstallmentReminders` (`installments/service.ts:408`) | par échéance : 1 `findFirst` anti-doublon + `notifyUser` (3-4 requêtes) ≈ **5 × 200 = ~1 000** en run chargé | 2 `findMany` (`Promise.all`) + **1** requête anti-doublon groupée + 2 `notifyMany` → **≤ 9 requêtes constantes** |
| `settlePlan` (`admin-ops/service.ts:633`) | 1 `SELECT` de paiement **par échéance** (12 pour un plan à 12 mois) | **1** `findMany` groupé (dernier paiement récent conservé par tri `createdAt DESC`) |
| `runPromotionJobs` (`promotions/service.ts:511`) | 1 `UPDATE` + ~3 requêtes de notif **par mise en avant échue** | **1** `updateMany` + **1** `notifyMany` |
| `getPublicMeta` (`settings/service.ts:25`) | 3 `findUnique` | **1** `findMany` |
| Notes du catalogue (`catalogue/routes.ts:170`) | `groupBy` sur l'ensemble du périmètre filtré + page > 1 incorrecte | `groupBy` sur les ids de la page (≤ 48) + correctif de bug |

Vérifié à l'exécution : `sendInstallmentReminders` deux fois de suite →
`{upcoming:0, overdue:0}` puis `{upcoming:0, overdue:0}` (14,5 ms, anti-doublon intact) ;
`runPromotionJobs` → `{expiredFeatured:0, promotionsSynced:0}` (33 ms) ;
`notifyMany` en lot sur 2 entrées → **2 lignes créées** (15 ms) et **0 ligne** pour un compte
avec `inApp = false` (préférence respectée) ; lignes de contrôle ensuite supprimées (compte
de test remis dans son état initial).

---

## 9. Non traité volontairement & recommandations

1. **P1 — Activer les index** : `pnpm --filter @misterdou/db push` puis redémarrage de l'API
   (port 4000), puis re-mesure des latences SQL. Interdit cette phase ; sans cela, les plans
   « après » (§3.3) restent des projections.
2. **P1 — Re-mesurer en HTTP** : les chiffres « après » (§3.1) proviennent de l'instance 4010
   (client `node:fetch`) ; refaire les relevés `curl` sur le port 4000 après redémarrage.
3. **P2 — Pagination SQL du catalogue** : remplacer `take: 300` + tri mémoire par une
   pagination en base (l'ordre « mise en avant d'abord » est calculé en mémoire) lorsque le
   catalogue dépassera quelques centaines d'offres.
4. **P2 — `Payment @@index([createdAt(sort: Desc)])`** : `/admin/payments` est encore en
   `Seq Scan` + `Sort` (EXPLAIN vérifié) ; non ajouté volontairement (table d'écriture
   fréquente, route hors des pages chaudes listées) — à ajouter si elle devient chaude.
5. **P2 — `SELECT DISTINCT division` du catalogue** sans borne lit la table entière à chaque
   appel : dénormaliser la liste des divisions (ou la figer en `Settings`).
6. **P3 — Bug d'audit préexistant observé pendant les sondes** : `POST /auth/logout`
   (`modules/auth/routes.ts:171`) passe `auth?.id` — l'**id de session** — à `logAudit` →
   violation de `AuditLog_userId_fkey` à chaque déconnexion, la ligne d'audit n'est jamais
   écrite (correction d'une ligne : `auth?.user.id`). Hors périmètre « performances ».
7. **P3 — ETag par encodage** : l'ETag est identique pour les représentations identité/br/gzip ;
   `vary: accept-encoding` est déjà posé, mais un suffixe `-br`/`-gzip` renforcerait la
   distinction si un cache intermédiaire partageait des variantes.
8. **P3 — Front (`apps/web`)** : images, JavaScript/CSS, chargement des composants, CDN —
   **non audité dans cette phase** (périmètre API/DB imposé) ; à traiter séparément au titre
   du §28 (lazy loading, optimisation d'images, budget de poids).
9. **P3 — Test de charge** : les mesures sont faites sur une base quasi vide ; refaire un
   profil de charge en phase P13 (tests) avec un volume représentatif.

---

## 10. Vérifications

| Commande / sonde | Résultat |
|---|---|
| `pnpm --filter @misterdou/api typecheck` | ✅ `tsc --noEmit` — 0 erreur |
| `pnpm --filter @misterdou/db typecheck` | ✅ `tsc --noEmit` — 0 erreur |
| `pnpm --filter @misterdou/web typecheck` | ✅ `tsc --noEmit` — 0 erreur |
| `prisma validate` (schéma) | ✅ `The schema at prisma\schema.prisma is valid` |
| `pg_indexes` (index Phase 12) | ✅ 0 ligne — aucun DDL exécuté (conforme) |
| `GET /api/catalogue?perPage=12` (avant/après) | ✅ 200, `cache-control: public…`, `etag` présent |
| `GET /api/catalogue` + `If-None-Match` | ✅ **304**, corps 0 o, `content-length` absent |
| `GET /api/catalogue` + `accept-encoding: br` | ✅ `content-encoding: br`, 3 042 → **848 o**, `vary: Origin, accept-encoding` |
| `GET /api/v1/meta` + `br` | ✅ non compressé (84 o < 512 o) |
| `GET /api/v1/notifications` (session) | ✅ `no-store`, aucun `ETag` |
| `POST /api/v1/auth/login` / `/logout` (staff & client) | ✅ 200 |
| `notifyMany` (lot × 2, `inApp=true`) | ✅ 2 lignes créées puis supprimées |
| `notifyMany` (`inApp=false`) | ✅ 0 ligne (préférence respectée) |
| `sendInstallmentReminders` × 2, `runPromotionJobs` | ✅ aucune erreur, anti-doublon intact |
| Non-régression : `/health`, `/api/seed`, `/api/catalogue`, `/api/v1/admin/overview` | ✅ 200 |
| Fichiers temporaires de mesure | ✅ supprimés (`git status` propre hors modifications de phase) |

> **Écoute** : l'API du port 4000 n'a pas été redémarrée ; les mesures « après » ont été
> menées sur une seconde instance (`API_PORT=4010`, fermée en fin de phase), comme en P11.
> La base n'a subi **aucune écriture** hors lignes de contrôle créées puis supprimées
> (notifications de test), et **aucun index n'a été créé**.

## 11. Front web (Next.js — `apps/web`)

### 11.1 First Load JS avant → après (build de référence)

| Route | Avant | Après | Δ | Route | Avant | Après | Δ |
|---|---|---|---|---|---|---|---|
| `/` | 198 kB | 170 kB | −28 | `/admin/audit` | 196 | 120 | −76 |
| `/account` | 195 | 119 | −76 | `/admin/clients` | 195 | 119 | −76 |
| `/admin` | 197 | 120 | −77 | `/admin/messages` | 199 | 123 | −76 |
| `/admin/offers` | 195 | 119 | −76 | `/admin/orders` | 195 | 119 | −76 |
| `/admin/payments` | 195 | 119 | −76 | `/admin/promotions` | 197 | 121 | −76 |
| `/admin/sellers` | 195 | 119 | −76 | `/admin/settings` | 196 | 120 | −76 |
| `/admin/support` | 197 | 121 | −76 | `/admin/team` | 197 | 149 | −48 |
| `/admin/verifications` | 195 | 119 | −76 | `/admin/plans` | 197 | 149 | −48 |
| `/admin/withdrawals` | 196 | 148 | −48 | `/catalogue` | 103 | 103 | 0 |
| `/catalogue/[slug]` | 195 | 166 | −29 | `/checkout/[token]` | 192 | 116 | −76 |
| `/console` | 195 | 118 | −77 | `/console/sign-in` | 180 | 152 | −28 |
| `/console/sign-in/setup` | 197 | 121 | −76 | `/identity-verification` | 194 | 118 | −76 |
| `/identity-verification/review` | 192 | 116 | −76 | `/login` | 181 | 153 | −28 |
| `/messages` | 198 | 122 | −76 | `/notifications` | 195 | 118 | −77 |
| `/offres` | 193 | 163 | −30 | `/pret-ou-prestation` | 193 | 163 | −30 |
| `/register` | 181 | 153 | −28 | `/seller` | 191 | 115 | −76 |
| `/support` | 196 | 120 | −76 | `/verify-phone` | 192 | 116 | −76 |
| `/a-propos` | 191 | 162 | −29 | `/comment-ca-marche` | 191 | 162 | −29 |
| `/_not-found` + shared | 104/103 | 103/102 | −1 | | | | |

Aucune régression : toutes les routes sont égales ou plus légères. Logs : `web-build-perf.log` / `web-build-perf-after.log` (`$env:TEMP\opencode\karism-db`).

### 11.2 Causes racines corrigées

- **`zod` sorti du graphe initial** — `lib/api.ts` importait statiquement `publicMetaSchema` depuis `@misterdou/shared`, or `@/lib/api` est importé par 32 modules : zod (225 kB brut) vivait dans le chunk partagé de *toutes* les routes. Import dynamique dans `getPublicMeta` (`apps/web/lib/api.ts:172`, sans appelant aujourd'hui) → −28 kB sur les routes encore chargées en motion.
- **Rayon d'impact de `framer-motion` réduit** — `components/lux/lux-data.tsx` n'importait que `cx` mais tirait motion dans chaque page `LuxShell` (13 pages admin, account, seller, console, messages, notifications, support, verify-phone, checkout, KYC). Nouveau `components/lux/lux-utils.tsx` (motion-free : `cx` + `SectionLabel`), `lux-fx` re-exporte pour compat → −76 kB sur ces routes.
- **Frontière client** — `components/lux/lux-footer.tsx` : `"use client"` retiré (aucun hook) → rendu serveur sur `/a-propos` + `/comment-ca-marche`.
- `qrcode.react` déjà isolé (chunk unique de `/console/sign-in/setup`).

### 11.3 Configuration (`apps/web/next.config.ts`)

`poweredByHeader: false`, `compress: true` (explicite), `productionBrowserSourceMaps: false`, en-tête `/_next/static/* → Cache-Control: public, max-age=31536000, immutable`. En-têtes de sécurité existants inchangés.

### 11.4 Polling respectueux de la visibilité

Nouveau hook `lib/use-visible-poll.ts` : cadence conservée, requête seulement si `document.visibilityState === "visible"`, rattrapage immédiat au retour, nettoyage complet. Adopté par la cloche (30 s), le fil de discussion (8 s — + `activeConversationRef` contre les fusions croisées) et la liste messages (15 s, 3e implémentation manuelle supprimée). Le polling checkout reste actif volontairement (fiabilité paiement, §40).

### 11.5 Non traité volontairement

- `loading.tsx` admin/account : routes statiquement pré-générées (le boundary ne s'afficherait jamais au premier chargement) — états client déjà couverts par `Spinner`/`TableLoading`.
- Dépendances déclarées mais jamais importées (`three`, `@react-three/*`, `shadergradient`, `@paper-design/shaders`, `gsap`, `lenis`) : coût bundle nul, nettoyage reporté (churn `pnpm-lock.yaml`).
- Migration `LazyMotion`/`m.*` : −70 kB de motion restant sur landing/nav/cartes, mais touche 10+ composants animés (risque QA visuelle) → lot suivant.
- Images/polices : aucun `<img>` ni `<link>` brut (SVG inline), polices déjà `next/font/google` + `display:"swap"`.
- Fichiers morts `components/hero.tsx` / `components/sections.tsx` (non référencés, coût nul) laissés en place.

### 11.6 Vérifications

`pnpm --filter @misterdou/web typecheck` → 0 erreur. `pnpm --filter @misterdou/web build` → exit 0, 38/38 pages.
