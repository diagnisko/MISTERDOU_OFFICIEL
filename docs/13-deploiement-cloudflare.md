# Déploiement sur Cloudflare

Tout tourne chez Cloudflare, sur le compte déjà relié au GitHub du projet :

| Partie | Où | Fichiers |
|---|---|---|
| Site (Next.js) | Worker `misterdou-officiel`, via OpenNext | `apps/web/wrangler.jsonc`, `apps/web/cloudflare-worker.ts`, `apps/web/open-next.config.ts` |
| API (Fastify) | Worker `misterdou-api` + Container (image Docker) | `deploy/api/`, `apps/api/Dockerfile`, `.dockerignore` |
| Base de données | Neon (inchangé) | — |
| Fichiers | R2 : bucket privé (pièces d'identité) et bucket public (photos, vidéos) | — |

Le site reçoit toutes les requêtes. `/api/*` part vers l'API par une liaison de service
(`API`) : même origine pour le navigateur, l'API n'a pas d'adresse publique. Les rendus
serveur du site passent aussi par cette liaison (`apps/web/lib/server-api.ts`).

Une seule instance de l'API tourne (`max_instances: 1`), pour que les tâches de fond
(échéances, forfaits de mise en avant, libération des fonds vendeurs) ne tournent jamais
en double. Un déclencheur toutes les 30 minutes la réveille si elle s'est endormie.

La mise en ligne se fait par la connexion Git de Cloudflare (Workers Builds) : à chaque
envoi sur `master`, Cloudflare construit et met en ligne les deux Workers.

## Mise en place (une fois)

1. **Offre Workers payante** (Workers & Pages > Plans) : obligatoire pour les Containers.
2. **Sous-domaine workers.dev** (Workers & Pages) : l'adresse du site sera
   `https://misterdou-officiel.diagnisko21.workers.dev`.
3. **R2** : créer deux buckets, par exemple `misterdou-private` et `misterdou-media`.
   - Sur `misterdou-media` : activer l'accès public (URL `r2.dev` ou domaine) et ajouter une
     règle CORS autorisant `PUT` et `GET` depuis l'adresse du site.
   - Créer un jeton R2 (R2 > Manage API tokens) en lecture et écriture sur ces deux buckets.
4. **Worker de l'API, en premier** (le site dépend de lui) : Workers & Pages > Create >
   Import a repository > dépôt `MISTERDOU_OFFICIEL`.

   | Réglage | Valeur |
   |---|---|
   | Project name | `misterdou-api` (doit être identique au `name` de `deploy/api/wrangler.jsonc`) |
   | Production branch | `master` |
   | Root directory (Path) | `deploy/api` |
   | Build command | (vide : Cloudflare installe les dépendances lui-même) |
   | Deploy command | `npx wrangler deploy` |

5. **Secrets de l'API** (`misterdou-api` > Settings > Variables and Secrets, type *Secret*) :

   | Nom | Valeur |
   |---|---|
   | `WEB_ORIGIN`, `API_PUBLIC_URL` | adresse du site (`https://misterdou-officiel.diagnisko21.workers.dev`, sans `/` final) |
   | `DATABASE_URL` | URL Neon de production (`?sslmode=require`) |
   | `COOKIE_SECRET` | 48 caractères aléatoires ou plus |
   | `STORAGE_MASTER_KEY` | la même clé qu'aujourd'hui (sinon les pièces déjà chiffrées deviennent illisibles) |
   | `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` | jeton R2 |
   | `R2_PRIVATE_BUCKET`, `R2_PUBLIC_BUCKET`, `R2_PUBLIC_BASE_URL` | buckets et URL publique |
   | `SMTP_URL`, `EMAIL_FROM` | envoi des e-mails (facultatif) |
   | `PAYTECH_*`, `GOOGLE_OAUTH_*` | quand ces services sont prêts |

   Toujours en type *Secret* : une variable simple ajoutée dans le tableau de bord serait
   effacée à la mise en ligne suivante. Après l'ajout, relancer la construction
   (Deployments > Retry) pour que le serveur redémarre avec eux.

6. **Worker du site** : Import a repository > même dépôt.

   | Réglage | Valeur |
   |---|---|
   | Project name | `misterdou-officiel` |
   | Production branch | `master` |
   | Root directory (Path) | `apps/web` |
   | Build command | `pnpm run cf:build` |
   | Deploy command | `pnpm run cf:deploy` |

## Vérifier

- `https://<site>/api/v1/health` répond `ok`.
- Journaux : Workers & Pages > `misterdou-api` (ou `misterdou-officiel`) > Logs.

## À savoir

- `PAYTECH_SANDBOX` vaut `true` dans `deploy/api/wrangler.jsonc` : paiements de test
  tant que PayTech n'est pas branché en réel.
- Domaine personnalisé (`misterdou.com`) : l'ajouter sur `misterdou-officiel` (Settings >
  Domains & Routes), mettre à jour `WEB_ORIGIN` et `API_PUBLIC_URL`, et ajouter le domaine
  à la règle CORS du bucket des médias.
