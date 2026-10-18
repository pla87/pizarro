# syntax=docker/dockerfile:1.7
# Imagen multi-stage de Tablón:
#   deps → build (Next standalone + script de arranque) → migrator (Prisma CLI aislado) → runner
ARG NODE_IMAGE=node:22-bookworm-slim

# --- Base común: OpenSSL es necesario para que Prisma elija el motor correcto ---
FROM ${NODE_IMAGE} AS base
RUN apt-get update \
    && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*
ENV NEXT_TELEMETRY_DISABLED=1
WORKDIR /app

# --- 1. Dependencias completas (para compilar) ---------------------------------
FROM base AS deps
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --no-audit --no-fund

# --- 2. Build -----------------------------------------------------------------
FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# prisma generate no conecta a la base de datos; solo necesita la variable definida.
RUN DATABASE_URL="postgresql://build:build@localhost:5432/build" npm run build

# --- 3. Prisma CLI aislado, solo para `migrate deploy` -----------------------------
FROM base AS migrator
WORKDIR /app/migrator
COPY package.json /tmp/app-package.json
RUN --mount=type=cache,target=/root/.npm \
    PRISMA_VERSION="$(node -p "require('/tmp/app-package.json').devDependencies.prisma")" \
    && echo '{"name":"tablon-migrator","private":true,"type":"module"}' > package.json \
    && npm install --no-audit --no-fund --omit=dev "prisma@${PRISMA_VERSION}" \
    # Descarga el motor de migraciones en el build (no en cada arranque).
    && DATABASE_URL="postgresql://x:x@localhost:5432/x" ./node_modules/.bin/prisma --version
COPY prisma.config.ts ./
COPY prisma ./prisma

# --- 4. Runtime -----------------------------------------------------------------
FROM base AS runner
ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    UPLOAD_DIR=/app/uploads

RUN mkdir -p /app/uploads && chown node:node /app /app/uploads

COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=migrator --chown=node:node /app/migrator ./migrator
COPY --chown=node:node changelog.json ./
COPY --chown=node:node scripts/start.sh ./scripts/start.sh

# Volumen persistente para las capturas (en Railway se monta un Volume en esta ruta).
VOLUME /app/uploads

USER node
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# Migraciones + changelog + seed idempotente + servidor.
CMD ["sh", "scripts/start.sh"]
