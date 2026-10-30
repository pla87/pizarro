// Enlace de recuperación de contraseña desde la línea de órdenes, para cuando no hay email ni ningún admin puede entrar.
// Imprime una URL de un solo uso (válida 30 minutos). Con --reset-2fa borra además la verificación en dos pasos de esa persona.
//
//   docker compose exec app node dist/reset-link.mjs persona@example.com [--reset-2fa]
//   (en desarrollo: npx tsx scripts/reset-link.ts persona@example.com)
//
// Variables: DATABASE_URL y APP_URL (las mismas que la app).
import { db } from "@/lib/db";
import { createResetLink } from "@/lib/reset-link";

async function main() {
  const args = process.argv.slice(2);
  const flags = args.filter((a) => a.startsWith("--"));
  const emails = args.filter((a) => !a.startsWith("--"));
  if (emails.length !== 1 || flags.some((f) => f !== "--reset-2fa")) {
    console.error("Uso: reset-link <email> [--reset-2fa]   (variables: DATABASE_URL, APP_URL)");
    process.exitCode = 2;
    return;
  }
  const res = await createResetLink(emails[0]!, { appUrl: process.env.APP_URL ?? "http://localhost:3000", reset2fa: flags.includes("--reset-2fa") });
  if (!res.ok) {
    console.error(`[reset-link] ${res.error}`);
    process.exitCode = 1;
    return;
  }
  if (flags.includes("--reset-2fa")) console.log(res.twoFactorCleared ? "[reset-link] Verificación en dos pasos borrada." : "[reset-link] Esa persona no tenía verificación en dos pasos.");
  console.log(`[reset-link] Enlace para ${res.name} (un solo uso, caduca en 30 minutos). Envíaselo por un canal de confianza:`);
  console.log(res.url);
}

main()
  .catch((err) => {
    console.error("[reset-link] ERROR:", err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
