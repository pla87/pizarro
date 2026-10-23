// Tareas de arranque del contenedor (tras las migraciones): sincroniza el
// changelog y ejecuta el seed idempotente. Un solo proceso para arrancar rápido.
import { db } from "@/lib/db";
import { syncChangelog } from "@/lib/changelog-sync";
import { seed } from "@/lib/seed";
import { seedBuiltinTemplates } from "@/lib/template-store";

async function main() {
  try {
    const { version } = (await import("../package.json")) as { version: string };
    await db.appLog.create({
      data: { level: "info", category: "system", action: "system.boot", message: `Arranque de Pizarro v${version}`, details: { version, node: process.version } },
    });
  } catch (err) {
    console.error("[boot] No se pudo registrar el arranque:", err);
  }
  const n = await syncChangelog(db);
  console.log(`[boot] Changelog sincronizado (${n} versiones).`);
  await seed(db, (m) => console.log(m.replace("[seed]", "[boot]")));
  const plantillas = await seedBuiltinTemplates(db);
  if (plantillas.length) console.log(`[boot] Plantillas de proyecto por defecto creadas: ${plantillas.join(", ")}.`);
}

main()
  .catch((err) => {
    console.error("[boot] Error:", err);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
