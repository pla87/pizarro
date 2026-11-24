// Tareas de arranque (tras las migraciones): registra el arranque, sincroniza el changelog, ejecuta el seed idempotente,
// anuncia el código del asistente /setup y prepara las plantillas de serie. El contenedor lo ejecuta como proceso aparte
// (`node dist/boot.mjs`, en scripts/start.sh); `npm start` lo importa y llama a runBoot() antes de cargar el servidor
// (scripts/start-local.mjs), así las dos formas de arrancar hacen lo mismo.
import path from "node:path";
import { pathToFileURL } from "node:url";
import { applyAppUrlFallback } from "@/lib/app-url";
import { db } from "@/lib/db";
import { configWarnings } from "@/lib/doctor-core";
import { englishLogMessage, LOG_LABEL_KEY } from "@/lib/log-message";
import { syncChangelog } from "@/lib/changelog-sync";
import { seed } from "@/lib/seed";
import { announceSetup } from "@/lib/setup";
import { retireBuiltinTemplates, seedBuiltinTemplates, upgradeBuiltinTemplates } from "@/lib/template-store";

async function main() {
  // Sin APP_URL, la dirección pública de Railway (lib/app-url.ts): la usa el enlace de /setup que se imprime abajo.
  applyAppUrlFallback(process.env, (m) => console.log(`[boot] ${m}`));
  // Los mismos avisos de configuración que el diagnóstico (p. ej. NODE_OPTIONS con --max-old-space-size), en el log del arranque.
  for (const w of configWarnings()) console.warn(`[boot] Aviso: ${w.text}`);
  try {
    const { version } = (await import("../package.json")) as { version: string };
    const message = `Arranque de Pizarro v${version}`;
    const label = { k: "Arranque de Pizarro v{version}", p: { version } };
    await db.appLog.create({
      data: { level: "info", category: "system", action: "system.boot", message, messageEn: englishLogMessage({ message, details: { [LOG_LABEL_KEY]: label } }), details: { version, node: process.version, [LOG_LABEL_KEY]: label } },
    });
  } catch (err) {
    console.error("[boot] No se pudo registrar el arranque:", err);
  }
  const n = await syncChangelog(db);
  console.log(`[boot] Changelog sincronizado (${n} versiones).`);
  await seed(db, (m) => console.log(m.replace("[seed]", "[boot]")));
  // Sin usuarios y sin SEED_ADMIN_*: código de un solo uso para el asistente web /setup (se imprime en este log).
  await announceSetup(db);
  // Las plantillas de serie no deben impedir que la app arranque.
  try {
    const retiradas = await retireBuiltinTemplates(db);
    if (retiradas.removed.length) console.log(`[boot] Plantillas de serie retiradas: ${retiradas.removed.join(", ")}.`);
    if (retiradas.kept.length) console.log(`[boot] Plantillas de serie retiradas que se conservan como propias (estaban modificadas): ${retiradas.kept.join(", ")}.`);
    const plantillas = await seedBuiltinTemplates(db);
    if (plantillas.length) console.log(`[boot] Plantillas de serie creadas: ${plantillas.join(", ")}.`);
    const actualizadas = await upgradeBuiltinTemplates(db);
    if (actualizadas.length) console.log(`[boot] Plantillas de serie actualizadas: ${actualizadas.join(", ")}.`);
  } catch (err) {
    console.error("[boot] No se pudieron preparar las plantillas de serie:", err);
  }
}

/**
 * Ejecuta las tareas de arranque y cierra su conexión. Lanza si fallan (base inaccesible, migraciones sin aplicar).
 * src/lib/db.ts deja el cliente en globalThis (una sola copia por proceso); aquí se quita al terminar: si no,
 * el servidor cargado después en el mismo proceso (`npm start`) heredaría este cliente ya desconectado.
 */
export async function runBoot(): Promise<void> {
  try {
    await main();
  } finally {
    await db.$disconnect();
    const g = globalThis as unknown as { prisma?: unknown };
    if (g.prisma === db) delete g.prisma;
  }
}

// Ejecutado directamente (`node dist/boot.mjs`), no importado.
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  runBoot().catch((err) => {
    console.error("[boot] Error:", err);
    process.exitCode = 1;
  });
}
