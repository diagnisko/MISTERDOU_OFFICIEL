# Déploiement sur Cloudflare

Tout tourne chez Cloudflare :

| Partie | Où | Fichiers |
|---|---|---|
| Site (Next.js) | Worker `misterdou-web`, via OpenNext | `apps/web/wrangler.jsonc`, `apps/web/cloudflare-worker.ts`, `apps/web/open-next.config.ts` |
| API (Fastify) | Worker `misterdou-api` + Container (image Docker) | `deploy/api/`, `apps/api/Dockerfile`, `.dockerignore` |
| Base de données | Neon (inchangé) | — |
| Fichiers | R2 : bucket privé (pièces d'identité) et bucket public (photos, vidéos) | — |

Le site reçoit toutes les requêtes. `/api/*` part vers l'API par une liaison de service
(`API`) : même origine pour le navigateur, l'API n'a pas d'adresse publique. Les rendus
serveur du site passent aussi par cette liaison (`apps/web/lib/server-api.ts`).

Une seule instance de l'API tourne (`max_instances: 1`), pour que les tâches de fond
(échéances, forfaits de mise en avant, libération des fonds vendeurs) ne tournent jamais
en double. Un déclencheur toutes les 30 minutes la réveille si elle s'est endormie.

La mise en ligne se fait par GitHub Actions (`.github/workflows/deploy.yml`) à chaque
envoi sur `master` : Docker et la mémoire nécessaires à la construction sont fournis par
GitHub.

## Mise en place (une fois)

1. **Offre Workers payante** (Workers & Pages > Plans) : obligatoire pour les Containers.
2. **Sous-domaine workers.dev** (Workers & Pages > Overview) : l'adresse du site sera
   `https://misterdou-web.<sous-domaine>.workers.dev`.
3. **R2** : créer deux buckets, par exemple `misterdou-private` et `misterdou-media`.
   - Sur `misterdou-media` : activer l'accès public (URL `r2.dev` ou domaine) et ajouter une
     règle CORS autorisant `PUT` et `GET` depuis l'adresse du site.
   - Créer un jeton R2 (R2 > Manage API tokens) en lecture et écriture sur ces deux buckets.
4. **Jeton Cloudflare pour GitHub** (My Profile > API Tokens > Create Token > modèle
   *Edit Cloudflare Workers*, limité à ce compte). Si le déploiement signale un droit
   manquant sur les Containers, ajouter la permission *Containers: Edit*.
5. **GitHub** (dépôt > Settings > Secrets and variables > Actions) :
   - secrets `CLOUDFLARE_API_TOKEN` et `CLOUDFLARE_ACCOUNT_ID` ;
   - variable `SITE_URL` = adresse du site (sans `/` final).
6. Lancer le déploiement (Actions > Déploiement Cloudflare > Run workflow).
7. **Secrets de l'API** (Workers & Pages > `misterdou-api` > Settings > Variables and
   Secrets, type *Secret*) :

   | Nom | Valeur |
   |---|---|
   | `DATABASE_URL` | URL Neon de production (`?sslmode=require`) |
   | `COOKIE_SECRET` | 48 caractères aléatoires ou plus |
   | `STORAGE_MASTER_KEY` | la même clé qu'aujourd'hui (sinon les pièces déjà chiffrées deviennent illisibles) |
   | `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` | jeton R2 |
   | `R2_PRIVATE_BUCKET`, `R2_PUBLIC_BUCKET`, `R2_PUBLIC_BASE_URL` | buckets et URL publique |
   | `SMTP_URL`, `EMAIL_FROM` | envoi des e-mails (facultatif) |
   | `PAYTECH_*`, `GOOGLE_OAUTH_*` | quand ces services sont prêts |

   Après l'ajout des secrets, relancer le workflow : le serveur redémarre avec eux.

## Vérifier

- `https://<site>/api/v1/health` répond `ok`.
- Journaux : Workers & Pages > `misterdou-api` (ou `misterdou-web`) > Logs.

## À savoir

- `PAYTECH_SANDBOX` vaut `true` dans `deploy/api/wrangler.jsonc` : paiements de test
  tant que PayTech n'est pas branché en réel.
- Un domaine personnalisé s'ajoute plus tard sur `misterdou-web` (Settings > Domains &
  Routes) ; mettre alors `SITE_URL` à jour et relancer le déploiement.
