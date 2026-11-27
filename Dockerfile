# Imagen multi-stage de Pizarro:
#   manifests (versión fija) → deps → build (Next standalone + scripts de dist/) → migrator (Prisma CLI aislado) → runner

# --- Base común: OpenSSL es necesario para que Prisma elija el motor correcto ---
# Imagen base fijada por digest, como las acciones de GitHub por SHA: etiqueta node:22-bookworm-slim (Node 22 sobre
# Debian 12 con glibc). El digest es el del índice multiarquitectura (amd64 y arm64). Dependabot (ecosistema docker,
# .github/dependabot.yml) propone el digest nuevo cuando la etiqueta cambia; a mano:
#   docker buildx imagetools inspect node:22-bookworm-slim   (línea «Digest:»)
# Va en el FROM y no en un ARG: Dependabot no sigue las variables.
FROM node:22-bookworm-slim@sha256:e9f565d32859f0cbfb52125eafe8be39390f24dac302dc3cdf566e8ba3ab21ee AS base
RUN apt-get update \
    && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*
ENV NEXT_TELEMETRY_DISABLED=1
WORKDIR /app

# --- 0. package.json y package-lock.json con la versión fija ----------------------
# La versión de la app cambia en cada publicación y está en los dos ficheros: copiados tal cual, invalidaban la caché de
# `npm ci` (aquí y en el migrador) aunque las dependencias fueran las mismas. Esta etapa se repite siempre (un segundo),
# pero su resultado solo cambia si cambian las dependencias (los `scripts` de package.json también se quitan: `npm ci`
# no usa ninguno): si no, Docker reutiliza las capas de instalación. La versión y los scripts reales los trae el
# package.json que la etapa de build copia con el código.
FROM base AS manifests
WORKDIR /tmp/manifests
COPY package.json package-lock.json ./
COPY scripts/docker-manifests.mjs /tmp/
RUN node /tmp/docker-manifests.mjs /tmp/manifests

# --- 1. Dependencias completas (para compilar) ---------------------------------
FROM base AS deps
COPY --from=manifests /tmp/manifests/package.json /tmp/manifests/package-lock.json ./
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
COPY --from=manifests /tmp/manifests/package.json /tmp/manifests/package-lock.json /tmp/app/
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
# MALLOC_ARENA_MAX=2: glibc crea un área de memoria por hilo y sharp (libvips) usa varios; con dos áreas la memoria del
# proceso al procesar imágenes baja un ~43 % (medido) sin cambio apreciable de velocidad. Se puede cambiar en el entorno.
ENV NODE_ENV=production \
    NEXT_MANUAL_SIG_HANDLE=1 \
    MALLOC_ARENA_MAX=2 \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    UPLOAD_DIR=/app/uploads

# El código es de root y no escribible por "node": si alguien lograra ejecutar código en el servidor
# no podría modificar la propia aplicación. Solo son de "node" las rutas que se escriben en ejecución:
# las subidas (en Railway, el Volume) y la caché de Next (.next/cache).
RUN mkdir -p /app/uploads /app/.next/cache && chown node:node /app/uploads /app/.next/cache

COPY --from=build /app/.next/standalone ./
COPY --from=build /app/dist ./dist
COPY --from=migrator /app/migrator ./migrator
COPY changelog.json ./
COPY scripts/start.sh scripts/migrate.mjs ./scripts/
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
