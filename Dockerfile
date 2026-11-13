# Imagen multi-stage de Pizarro:
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
RUN npm ci --no-audit --no-fund

# --- 2. Build -----------------------------------------------------------------
FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Commit opcional para el identificador de versión (next.config.ts): --build-arg GIT_SHA=<commit>.
# Railway pasa RAILWAY_GIT_COMMIT_SHA solo si se declara aquí. Sin ninguno de los dos se usa la hora del build.
ARG GIT_SHA=""
ARG RAILWAY_GIT_COMMIT_SHA=""
# Build oficial (solo informa; ver src/lib/bug-report-core.ts): el workflow Release pasa OFFICIAL_BUILD=1 y
# RELEASE_VERSION; en Railway cuentan el repositorio y la rama de origen (deben declararse aquí para recibirlos).
ARG OFFICIAL_BUILD=""
ARG RELEASE_VERSION=""
ARG RAILWAY_GIT_REPO_OWNER=""
ARG RAILWAY_GIT_REPO_NAME=""
ARG RAILWAY_GIT_BRANCH=""
# prisma generate no conecta a la base de datos; solo necesita la variable definida.
RUN DATABASE_URL="postgresql://build:build@localhost:5432/build" npm run build

# --- 3. Prisma CLI aislado, solo para `migrate deploy` -----------------------------
FROM base AS migrator
WORKDIR /app/migrator
COPY package.json package-lock.json /tmp/app/
COPY scripts/migrator-deps.mjs /tmp/app/scripts/
# Mismas versiones que el proyecto: el package-lock.json del migrador sale del del proyecto (solo prisma y lo que
# necesita) y `npm ci` lo instala tal cual, con sus hashes; la instalación descarga el motor de migraciones (no en cada
# arranque). Después se quita lo que `migrate deploy` no usa (Prisma Studio, `prisma dev`, los compiladores de
# consultas…): unos 150 MB menos sin comprimir. Ver scripts/migrator-deps.mjs.
RUN node /tmp/app/scripts/migrator-deps.mjs /tmp/app /app/migrator \
    && npm ci --no-audit --no-fund --omit=dev \
    && node /tmp/app/scripts/migrator-deps.mjs --prune /app/migrator \
    && rm -rf /tmp/app /root/.npm
COPY prisma.config.ts ./
COPY prisma ./prisma
# Comprobación de la poda (si una versión nueva de Prisma necesita algo de lo quitado, falla aquí y no al arrancar):
# `migrate diff` carga la configuración y el esquema y usa el motor de migraciones, como `migrate deploy`.
RUN DATABASE_URL="postgresql://x:x@localhost:5432/x" ./node_modules/.bin/prisma --version >/dev/null \
    && DATABASE_URL="postgresql://x:x@localhost:5432/x" ./node_modules/.bin/prisma migrate diff --from-empty --to-schema prisma/schema.prisma --script >/dev/null

# --- 4. Runtime -----------------------------------------------------------------
FROM base AS runner
# NEXT_MANUAL_SIG_HANDLE=1: Next.js no gestiona SIGTERM/SIGINT; el apagado ordenado (guardar los registros pendientes y
# esperar a las peticiones y los emails en curso) lo hace src/instrumentation.ts (src/lib/shutdown.ts).
ENV NODE_ENV=production \
    NEXT_MANUAL_SIG_HANDLE=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    UPLOAD_DIR=/app/uploads

# El código es de root y no escribible por "node": si alguien lograra ejecutar código en el servidor
# no podría modificar la propia aplicación. Solo son de "node" las rutas que se escriben en ejecución:
# las subidas (en Railway, el Volume) y la caché de Next (.next/cache).
RUN mkdir -p /app/uploads /app/.next/cache && chown node:node /app/uploads /app/.next/cache

COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
COPY --from=build /app/dist ./dist
COPY --from=migrator /app/migrator ./migrator
COPY changelog.json ./
COPY scripts/start.sh ./scripts/start.sh
# Sin permiso de escritura para grupo ni otros (los directorios de "node" de arriba siguen siendo suyos).
RUN chmod -R go-w /app

# Las capturas se guardan en /app/uploads: en Railway se monta ahí un Volume desde
# el panel (Railway no admite la instrucción VOLUME en el Dockerfile); con Docker Compose,
# un volumen con nombre (deploy/compose.yml).
# Multiarquitectura (amd64 y arm64): la imagen base y los binarios de sharp y Prisma existen para
# ambas; se construye con `docker buildx build --platform linux/amd64,linux/arm64 .`

# El contenedor arranca como root solo para ajustar los permisos del volumen;
# scripts/start.sh baja inmediatamente al usuario "node".
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# Migraciones + changelog + seed idempotente + servidor.
CMD ["sh", "scripts/start.sh"]
