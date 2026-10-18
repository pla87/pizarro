import { db } from "@/lib/db";
import { syncChangelog } from "@/lib/changelog-sync";

syncChangelog(db)
  .then((n) => console.log(`[changelog] ${n} versiones sincronizadas.`))
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
