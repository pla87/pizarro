import { db } from "@/lib/db";
import { syncChangelog } from "@/lib/changelog-sync";
import { seed } from "@/lib/seed";

async function main() {
  await seed(db);
  const n = await syncChangelog(db);
  console.log(`[seed] Changelog sincronizado (${n} versiones).`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
