# 02 — Architecture technique

Version : 1.0 — 2026-09-23

---

## 1. Décision de stack

### 1.1 Monorepo pnpm workspaces

| Couche | Choix | Version |
|---|---|---|
| Gestion de workspace | pnpm workspaces | 10.x |
| Langage | TypeScript (strict) | 5.9 |
| Validation de données | zod | 4.x |
| ORM + migrations | Prisma | 6.19 (stable) |
| Base de données | PostgreSQL | 15+ |
| Frontend web | Next.js (App Router) + Tailwind CSS v4 + `motion` (léger) | 15.5 |
| Backend API | Node.js + Fastify 5 + TypeScript | 5.x |
| Auth | Sessions en base + cookies HttpOnly + scrypt (node:crypto, KDF natif) | — |
| Paiements | Lien Wave Business + preuve vérifiée par l'équipe (docs/06) | — |
| Stockage privé | Dossier local chiffré (dev) → S3/R2 chiffré (swap-ready) | — |
| Logs | pino (JSON structuré) | 10.x |
| Tests | vitest + testcontainers (postgres) + Supertest | en Phase 13 |

### 1.2 Pourquoi ces choix — 3 justifications fortes

1. **Performance et vitesse de démarrage** : Fastify est l'un des frameworks Node les plus
   rapides (benchmarks http), Next.js 15 avec App Router + RSC minimise le JS envoyé au
   client, Tailwind v4 purge le CSS inutilisé à la compilation, et pnpm installe/trie les
   dépendances de façon déterministe avec un cache global.
2. **Sécurité et fiabilité transactionnelle** : validation des entrées par zod (couche
   partagée entre web et API), contrôle d'accès 100 % côté serveur, Prisma (types sûrs +
   requêtes paramétrées = anti-SQLi), sessions en base révocables, paiements Wave validés par
   l'équipe et idempotents, chiffrement AES-256-GCM des données sensibles, stockage privé à accès
   signé temporaire.
3. **Évolutivité & réutilisation mobile** : API REST versionnée `/api/v1`, sans dépendance
   du frontend ; iOS/Android consommeront exactement la même API. Le découpage en paquets
   (`packages/db`, `packages/shared`) rend le backend réutilisable, testable et
   déployable indépendamment (scale horizontal des workers API séparé des jobs).

### 1.3 Pourquoi Fastify et pas NestJS
- NestJS impose un surcoût de réflexion/métadonnées et un boot plus lourd ; Fastify offre un
  cycle de vie à hooks, un système de plugins officiel et une vitesse supérieure — suffisant
  pour une API transactionnelle propre, avec une architecture en modules/routes très lisible.
- On garde le même niveau de discipline : routes déclarées par domaine, validation zod
  typée (`fastify-type-provider-zod`), schema OpenAPI auto-généré, erreurs normalisées.

---

## 2. Représentation en couches

```
┌─────────────────────────────────────────────────────────────────────┐
│  CLIENTS                                                             │
│  Web (Next.js, mobile-first, PWA-ready)   ·   Android / iOS (futur)  │
└───────────────┬───────────────────────────────┬─────────────────────┘
                │ HTTPS (cookies, CORS limité)  │ HTTPS (Bearer session)
                ▼                               ▼
┌─────────────────────────────────────────────────────────────────────┐
│  API SECURISÉE  (apps/api — Fastify, /api/v1)                        │
│  auth · verification · products · orders · payments · installments  │
│  seller · featured · support · messaging · notifications · admin    │
│  · rate-limit · helmet · sessions révocables · audit · RBAC         │
└───────┬──────────────────────────┬───────────────────┬─────────────┘
        │                          │                   │
        ▼                          ▼                   ▼
┌──────────────────┐   ┌────────────────────┐   ┌─────────────────────┐
│ POSTGRES (Prisma)│   │ STOCKAGE PRIVÉ     │   │ WAVE BUSINESS       │
│ users, orders,   │   │ docs KYC, selfies, │   │ lien de paiement    │
│ payments, solde… │   │ captures produit,  │   │ (montant rempli),   │
│           │      │   │ chiffré AES-GCM,   │   │ preuve vérifiée     │
│           ▼      │   │ accès par ticket   │   └─────────────────────┘
│ JOBS (cron):     │   │ signé/expirable    │
│ libération solde,│   └────────────────────┘
│ échéances, promos│
└──────────────────┘
```

- La **logique métier vit dans l'API** (couche service), jamais dans le frontend web.
- Les **jobs** (libération de solde, détection d'échéances en retard, expiration des mises
  en avant, purge de conservation) s'exécutent dans un processus séparé partageant la même
  couche de service de `apps/api` — réutilisable par des workers serverless plus tard.

---

## 3. Architecture du monorepo

```
MISTERDOU/
├─ pnpm-workspace.yaml
├─ package.json                 # scripts racine (dev, build, lint, db:*)
├─ .gitignore                   # .env*, node_modules, builds, uploads privés
├─ .env.example                 # modèle racine (copié dans chaque app)
├─ docs/                        # cahier des charges technique (cf. docs/0x)
├─ packages/
│  ├─ shared/                   # enums, types, DTOs, schémas zod — consommés par web & api
│  └─ db/                       # Schéma Prisma unique + client singleton + seed + PRISMA_DB
│     ├─ prisma/schema.prisma
│     └─ src/prisma.ts
├─ apps/
│  ├─ api/                      # Fastify : REST /api/v1, swagger, auth, settings, health
│  │  ├─ src/
│  │  │  ├─ index.ts            # bootstrap (choisit host/port, logs)
│  │  │  ├─ app.ts              # assemble plugins + routes
│  │  │  ├─ env.ts              # validation env (zod)
│  │  │  ├─ lib/                # errors, envelope, crypto, sessions, audit, rate-limit
│  │  │  ├─ modules/            # auth, settings, health, (verification, products… aux phases suiv.)
│  │  │  └─ scripts/bootstrap-admin.ts
│  │  └─ openapi/               # docs auto (swagger-ui)
│  └─ web/                      # Next.js App Router
│     ├─ app/                   # layout, landing, pages (shell en Phase 1)
│     ├─ components/            # design system maison (shadcn-style tokens)
│     └─ lib/api.ts             # client API typé (enveloppe + auth cookie)
└─ README.md                    # démarrage rapide
```

### Règles de dépendances
- `apps/web` → `packages/shared` (DTOs/zod) **et seulement** l'API (jamais la base de données).
- `apps/api` → `packages/db`, `packages/shared`.
- `packages/db` → aucune dépendance applicative (seul Prisma + dotenv).
- Pas de cycle entre packages. `packages/shared` est pur (zéro dépendance lourde : zod uniquement).

---

## 4. Détails par composant

### 4.1 Apps/api (REST)
- **Versioning** : préfixe `/api/v1`.
- **Enveloppe de réponse** uniforme : `{ ok, data, meta?, error? }` — stable pour les apps mobiles.
- **Erreurs** : classes `ApiError` avec code métier stable (`AUTH_INVALID_CREDENTIALS`,
  `KYC_REQUIRED`, `INSUFFICIENT_BALANCE`, …) + `error.code`, `error.message` i18n-able.
- **Sécurité** : `@fastify/helmet`, `@fastify/rate-limit`, cors restreint (origines en env),
  validation zod à la volée, sessions en `Session` table + cookie `sid` HttpOnly/Secure/SameSite=Lax
  (mêmes cookies pour le web), header CSRF (`csrf-token`) — voir docs/05.
- **OpenAPI** : `@fastify/swagger` — spec générée depuis les schémas zod des routes ; UI exposée
  uniquement en dev ou avec rôle ADMIN (`GET /docs`).
- **Logs** : pino JSON structuré ; redaction automatique des champs sensibles (password, tokens,
  credentials).

### 4.2 Apps/web (Next.js)
- App Router, server components par défaut, client components uniquement là où l'interaction
  l'exige (mini formatters côté client interdits pour les chiffres métier).
- **Tous les chiffres métier (prix, commission, soldes, mensualités, frais) proviennent de l'API ;
  le client les affiche tels quels, sans recalcul.** Un petit utilitaire de *formatage* monétaire
  (affichage) seulement — aucun calcul n'est fait dans le navigateur.
- Design tokens (tokens sémantiques, shadcn-style) dans `tokens.css` + Tailwind v4 : noir
  profond/e-sport, accent émeraude/cyan, surface glass — cf. `docs/08` pour la direction créative.
- Animations : `motion` (ex-framer-motion) en **doses légères** (fade-in au scroll, hover lift,
  transitions de page) ; `Performance > Animation`.

### 4.3 packages/db (Prisma)
- Schéma unique, source de vérité → migrations, génération du client typé.
- `engineType = "library"`, driver PostgreSQL. Index multiples pour recherche/filtre/pagination
  (voir docs/03).
- Seed : rôles initiaux, admin bootstrappé via script (env), settings par défaut vus en Phase 1.

### 4.4 packages/shared
- Enums métier (Role, KYC stats, paiement stats, statuts commande/licence/mise en avant…),
- Schémas zod **partagés** : la web et la API valident les mêmes contrats (pas de drift).
- DTOs de réponse (`OrderDto`, `InstallmentPlanDto`, …) pour une exposition stable.

### 4.5 Stockage des fichiers (Cloudflare R2)

Deux buckets, deux régimes (`apps/api/src/lib/storage.ts`, `apps/api/src/lib/media.ts`) :

- **Bucket privé — pièces d'identité.** L'API reçoit le fichier (multipart, 8 Mo, octets de
  tête vérifiés), le chiffre en AES-256-GCM (clé dérivée de `STORAGE_MASTER_KEY`) puis
  l'écrit dans `R2_PRIVATE_BUCKET`. Aucun accès public, aucune URL présignée : la lecture
  passe toujours par `GET /admin/kyc/:id/files/:kind` (permission KYC, journal d'audit,
  déchiffrement à la volée). En production l'API refuse de démarrer sans ce bucket.
- **Bucket public — images et vidéos des comptes.** `POST /products/:id/media/upload-url`
  renvoie une URL PUT présignée (10 min, type et taille signés) ; le navigateur envoie le
  fichier directement à R2 ; `POST /products/:id/media` vérifie l'objet reçu (taille, octets
  de tête) avant de l'enregistrer, sinon le supprime. Servi par `R2_PUBLIC_BASE_URL`.
  Limites : 10 images (JPEG/PNG/WebP, 8 Mo) et 2 vidéos (MP4/WebM, 60 Mo) par offre.
- **Développement sans R2** : mêmes parcours sur disque local (`STORAGE_DIR`), l'envoi
  local est protégé par une signature HMAC à durée limitée.

### 4.6 Readiness mobile (Phase 14+)
- L'API n'utilise **pas** de stateful websocket pour le cœur : notifications push via un canal
  retardé (worker → FCM/APNs) préparé dans `Notification`/`NotificationPreference`.
- Session API : cookie pour le web ; **Bearer** équivalent pour mobiles (même table `Session`,
  champ `kind = COOKIE|BEARER`). Aucun changement de logique métier requis.
- Toutes les routes/réponses sont compatibles JSON natif (pas de HTML ni de rendu côté API).

---

## 5. Déploiement et scalabilité

1. **Dev** : docker-compose (postgres) + `pnpm dev` (api sur :4000, web sur :3000).
2. **Prod (cible)** : conteneurs Docker séparés `api`, `worker`, `web` ; PostgreSQL managé
   (ou conteneur avec volumes + backups) ; CDN devant les assets publics du web ; CDN object
   storage privé (R2) pour les docs ; secrets via pipeline/env manager (jamais dans le repo).
3. **Scaling** : API/worker stateless (sessions en base, cache Redis optionnel à terme) ;
   jobs sous lock Postgres (`pg_advisory_lock`) pour éviter les doubles exécutions.

## 6. Stack retenue vs alternatives écartées

| Alternative | Écartée car… |
|---|---|
| NestJS | plus lourd, surcouche métadonnées, gain de structuration moindre vs modules Fastify |
| Express | trop minimal (bons participes : middleware ad hoc, moins performant) |
| Next API routes pour tout | mélange web/api, moins réutilisable mobile ; on garde l'API séparée |
| MongoDB / NoSQL | transactions, intégrité des soldes/échéances → relationnel requis |
| JWT stateless | révocabilité des sessions/sécurité admin exige des sessions serveur |
| Strapi/Supabase | pas de contrôle fin du schéma métier ni du paiement ; API tiers bloquante pour mobile |
| Vue/Svelte | écosystème React supérieur pour cette équipe + RSC + mobile-readiness via headers |