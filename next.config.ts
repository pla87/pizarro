import type { NextConfig } from "next";
import { proxyBodyLimitBytes } from "./src/lib/upload-size";

const isDev = process.env.NODE_ENV !== "production";

// Identificador de esta compilación: el navegador lo compara con el del servidor para detectar
// que hay una versión nueva desplegada (y recargar antes de llamar a acciones que ya no existen).
const buildId = (process.env.RAILWAY_GIT_COMMIT_SHA?.slice(0, 12) || Date.now().toString(36)) + (isDev ? "-dev" : "");

const nextConfig: NextConfig = {
  // Servidor autocontenido (.next/standalone): imagen Docker mucho más pequeña.
  output: "standalone",
  poweredByHeader: false,
  generateBuildId: () => buildId,
  env: { NEXT_PUBLIC_BUILD_ID: buildId, NEXT_PUBLIC_APP_TIMEZONE: process.env.APP_TIMEZONE || "Europe/Madrid" },
  reactStrictMode: true,
  serverExternalPackages: ["sharp", "@react-pdf/renderer"],
  experimental: {
    // Las imágenes van por /api/tasks/[id]/attachments; las acciones solo mueven JSON.
    serverActions: { bodySizeLimit: "1mb" },
    // El proxy almacena el cuerpo de la petición: debe admitir adjuntos de hasta MAX_UPLOAD_MB (más el
    // envoltorio multipart). Se fija al compilar: si se cambia MAX_UPLOAD_MB, debe estar definida también en el build.
    proxyClientMaxBodySize: proxyBodyLimitBytes(),
  },
  async headers() {
    return [
      {
        // La CSP (con nonce por petición) se fija en src/proxy.ts; aquí van el resto de cabeceras.
        // El informe PDF queda fuera: el visor de PDF de Chrome se queda en blanco con cabeceras restrictivas.
        source: "/((?!api/projects/[^/]+/report).*)",
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
