import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV !== "production";

// Identificador de esta compilación: el navegador lo compara con el del servidor para detectar
// que hay una versión nueva desplegada (y recargar antes de llamar a acciones que ya no existen).
const buildId = (process.env.RAILWAY_GIT_COMMIT_SHA?.slice(0, 12) || Date.now().toString(36)) + (isDev ? "-dev" : "");

const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

const nextConfig: NextConfig = {
  // Servidor autocontenido (.next/standalone): imagen Docker mucho más pequeña.
  output: "standalone",
  poweredByHeader: false,
  generateBuildId: () => buildId,
  env: { NEXT_PUBLIC_BUILD_ID: buildId },
  reactStrictMode: true,
  serverExternalPackages: ["sharp", "@react-pdf/renderer"],
  experimental: {
    // Las imágenes van por /api/tasks/[id]/attachments; las acciones solo mueven JSON.
    serverActions: { bodySizeLimit: "1mb" },
    // El proxy almacena el cuerpo de la petición: debe admitir capturas de hasta MAX_UPLOAD_MB.
    proxyClientMaxBodySize: "12mb",
  },
  async headers() {
    return [
      {
        // El informe PDF queda fuera de la CSP: el visor de PDF de Chrome se queda en blanco con object-src 'none'.
        source: "/((?!api/projects/[^/]+/report).*)",
        headers: [
          { key: "Content-Security-Policy", value: csp },
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
