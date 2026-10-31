import { readFileSync } from "node:fs";
import type { NextConfig } from "next";
import { PROXY_BODY_LIMIT_BYTES } from "./src/lib/upload-size";

const isDev = process.env.NODE_ENV !== "production";

// Identificador de esta compilación: el navegador lo compara con el del servidor para detectar
// que hay una versión nueva desplegada (y recargar antes de llamar a acciones que ya no existen).
// Versión del package.json + commit (GIT_SHA, o el que pone Railway) o, sin commit, la hora del build:
// no depende de ninguna plataforma y cambia en cada compilación distinta.
const version = (JSON.parse(readFileSync("package.json", "utf8")) as { version?: string }).version ?? "0.0.0";
const commit = (process.env.GIT_SHA || process.env.RAILWAY_GIT_COMMIT_SHA || "").replace(/[^0-9a-z]/gi, "").slice(0, 12);
const buildId = `${version}-${commit || Date.now().toString(36)}` + (isDev ? "-dev" : "");

const nextConfig: NextConfig = {
  // Servidor autocontenido (.next/standalone): imagen Docker mucho más pequeña.
  output: "standalone",
  poweredByHeader: false,
  generateBuildId: () => buildId,
  // Protección frente a desajuste de versión: Next añade el identificador a las peticiones del navegador y, si el servidor
  // responde con otro (despliegue nuevo), hace una navegación completa en vez de usar código y acciones que ya no existen.
  deploymentId: buildId.replace(/[^a-zA-Z0-9_-]/g, "-"),
  // La zona horaria ya no se fija aquí: el navegador la recibe del servidor (data-tz en <html>, ver lib/format.ts).
  env: { NEXT_PUBLIC_BUILD_ID: buildId },
  reactStrictMode: true,
  serverExternalPackages: ["sharp", "@react-pdf/renderer"],
  experimental: {
    // Las imágenes van por /api/tasks/[id]/attachments; las acciones solo mueven JSON.
    serverActions: { bodySizeLimit: "1mb" },
    // El proxy almacena el cuerpo de la petición: techo fijo del mayor adjunto posible (100 MB) más el envoltorio
    // multipart. El límite real (por proyecto, y MAX_UPLOAD_MB si existe) se aplica al subir, sin recompilar.
    proxyClientMaxBodySize: PROXY_BODY_LIMIT_BYTES,
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
          { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=()" },
          ...(isDev ? [] : [{ key: "Strict-Transport-Security", value: "max-age=31536000" }]),
        ],
      },
    ];
  },
};

export default nextConfig;
