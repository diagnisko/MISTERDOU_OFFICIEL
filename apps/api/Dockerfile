# Image de l'API MISTERDOU, exécutée dans un Container Cloudflare
# (voir deploy/api). Construite depuis la racine du dépôt (monorepo pnpm).
FROM node:22-bookworm-slim

# OpenSSL : requis par le moteur Prisma.
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
RUN corepack enable

WORKDIR /app

# Dépendances d'abord (couche mise en cache tant que les manifestes ne changent pas).
# Tous les package.json du dépôt : le lockfile décrit l'ensemble de l'espace de travail.
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/db/package.json packages/db/
COPY packages/shared/package.json packages/shared/
COPY deploy/api/package.json deploy/api/
RUN pnpm install --frozen-lockfile --filter "@misterdou/api..."

COPY packages packages
COPY apps/api apps/api
RUN pnpm --filter @misterdou/db generate

ENV NODE_ENV=production \
    API_HOST=0.0.0.0 \
    API_PORT=4000
EXPOSE 4000

# Repli disque des médias (seulement si le bucket public R2 manque).
RUN mkdir -p apps/api/.storage && chown node:node apps/api/.storage

USER node
WORKDIR /app/apps/api
CMD ["node_modules/.bin/tsx", "src/index.ts"]
