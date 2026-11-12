import { readFileSync } from "node:fs";
import path from "node:path";
import type { NextConfig } from "next";
import { buildCommit, officialBuild } from "./src/lib/bug-report-core";
import { PROXY_BODY_LIMIT_BYTES } from "./src/lib/upload-size";

const isDev = process.env.NODE_ENV !== "production";

// Identificador de esta compilación: el navegador lo compara con el del servidor para detectar
// que hay una versión nueva desplegada (y recargar antes de llamar a acciones que ya no existen).
// Versión del package.json + commit (GIT_SHA, o el que pone Railway) o, sin commit, la hora del build:
// no depende de ninguna plataforma y cambia en cada compilación distinta.
const version = (JSON.parse(readFileSync("package.json", "utf8")) as { version?: string }).version ?? "0.0.0";
const commit = (process.env.GIT_SHA || process.env.RAILWAY_GIT_COMMIT_SHA || "").replace(/[^0-9a-z]/gi, "").slice(0, 12);
const buildId = `${version}-${commit || Date.now().toString(36)}` + (isDev ? "-dev" : "");
// ¿Build oficial sin modificar? (imagen del workflow Release o Railway desde la rama stable del repositorio oficial;
// ver src/lib/bug-report-core.ts). Solo entonces la app ofrece «Informar de un error».
const official = isDev ? null : officialBuild(process.env, version);

// Datos que nunca deben acabar en .next/standalone. Al compilar fuera de Docker (donde .dockerignore no los aparta), el
// trazado de ficheros sigue rutas como path.resolve("./uploads") (upload-dir.ts) y copiaba las subidas, las copias de
// seguridad y los .env con sus secretos. Si UPLOAD_DIR apunta a otra carpeta dentro del proyecto, también se excluye.
// Esto cubre las rutas; lo que se escapa (el .env que Next copia por su cuenta y, con Turbopack, el trazado de
// instrumentation.js, al que no se aplica) lo borra scripts/postbuild.mjs.
const uploadRel = path.relative(process.cwd(), path.resolve(process.env.UPLOAD_DIR || "./uploads")).split(path.sep).join("/");
const tracingExcludes = [
  "./uploads/**",
  "./backups/**",
  "./.env*",
  "./deploy/.env*",
  "./deploy/recovery-kit*",
  ...(uploadRel && !uploadRel.startsWith("..") && !path.isAbsolute(uploadRel) && uploadRel !== "uploads" ? [`./${uploadRel}/**`] : []),
];

const nextConfig: NextConfig = {
  // Servidor autocontenido (.next/standalone): imagen Docker mucho más pequeña.
  output: "standalone",
  outputFileTracingExcludes: { "*": tracingExcludes },
  poweredByHeader: false,
  generateBuildId: () => buildId,
  // Protección frente a desajuste de versión: Next añade el identificador a las peticiones del navegador y, si el servidor
  // responde con otro (despliegue nuevo), hace una navegación completa en vez de usar código y acciones que ya no existen.
  deploymentId: buildId.replace(/[^a-zA-Z0-9_-]/g, "-"),
  // La zona horaria ya no se fija aquí: el navegador la recibe del servidor (data-tz en <html>, ver lib/format.ts).
  env: { NEXT_PUBLIC_BUILD_ID: buildId, NEXT_PUBLIC_GIT_COMMIT: buildCommit(process.env), NEXT_PUBLIC_OFFICIAL_BUILD: official ?? "" },
  reactStrictMode: true,
  // @react-pdf/renderer no está aquí: el servidor de Next no lo carga (solo importa sus tipos); el PDF se genera en un
  // worker con su propio paquete, dist/pdf-worker.mjs (scripts/postbuild.mjs).
  serverExternalPackages: ["sharp"],
  experimental: {
    // Las imágenes van por /api/tasks/[id]/attachments; las acciones solo mueven JSON.
    serverActions: { bodySizeLimit: "1mb" },
    // Next guarda en memoria el cuerpo de cada petición (no GET) que pasa por src/proxy.ts, hasta este tope, antes de que
    // llegue a la ruta (lo que pase de ahí se descarta). Por el proxy solo pasan acciones (1 MB) y JSON pequeños: las
    // subidas de archivos quedan fuera de su matcher y cada ruta lee el cuerpo con su propio tope. Así una petición enorme
    // (p. ej. a /login, sin cuenta) ya no ocupa su tamaño en memoria mientras llega.
    proxyClientMaxBodySize: PROXY_BODY_LIMIT_BYTES,
  },
  // Direcciones que solo redirigen: aquí la redirección es un 307 antes de pintar nada. Con redirect() en la página llegaba
  // dentro del Suspense de loading.tsx, con la página ya a medio enviar (y el navegador lo registraba como error).
  async redirects() {
    return [
      { source: "/admin", destination: "/admin/users", permanent: false },
      { source: "/admin/types", destination: "/admin/templates?vista=tipos", permanent: false },
    ];
  },
  async headers() {
    return [
      {
        // La CSP (con nonce por petición) se fija en src/proxy.ts; aquí van el resto de cabeceras.
        // El informe PDF queda fuera: el visor de PDF de Chrome se queda en blanco con cabeceras restrictivas.
        // Los documentos (/api/documents) también: su ruta fija las suyas (X-Frame-Options SAMEORIGIN para el visor de PDF).
        source: "/((?!api/projects/[^/]+/report|api/documents/).*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "same-origin" },
          // Aísla la pestaña de las ventanas que abra o que la abran desde otro sitio (no puede manipularla). El acceso
          // con Google va por redirección (no por ventana emergente), así que no le afecta.
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
          { key: "Permissions-Policy", value: "camera=(self), microphone=(self), geolocation=()" },
          ...(isDev ? [] : [{ key: "Strict-Transport-Security", value: "max-age=31536000" }]),
        ],
      },
    ];
  },
};

export default nextConfig;
