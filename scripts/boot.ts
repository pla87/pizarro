// Tareas de arranque del contenedor (tras las migraciones): sincroniza el
// changelog y ejecuta el seed idempotente. Un solo proceso para arrancar rápido.
import { db } from "@/lib/db";
import { syncChangelog } from "@/lib/changelog-sync";
import { seed } from "@/lib/seed";

async function main() {
  const n = await syncChangelog(db);
  console.log(`[boot] Changelog sincronizado (${n} versiones).`);
  await seed(db, (m) => console.log(m.replace("[seed]", "[boot]")));
}

main()
  .catch((err) => {
    console.error("[boot] Error:", err);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
