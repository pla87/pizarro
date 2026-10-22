// Restaura una copia de seguridad cifrada (.pzbak) en una base de datos VACÍA.
//
//   1) Crea una base de datos vacía y apunta DATABASE_URL a ella.
//   2) Aplica las migraciones:      npx prisma migrate deploy
//   3) Restaura:                    BACKUP_KEY=… npm run backup:restore -- ruta/a/pizarro-backup-….pzbak
//      (en el contenedor ya compilado: BACKUP_KEY=… node dist/restore-backup.mjs <fichero>)
//
// Verifica la copia entera antes de tocar nada y carga todo en una sola transacción: si falla,
// la base de datos queda como estaba. Se niega a restaurar sobre una base de datos con datos.
import { restoreDatabase } from "@/lib/backup-db";
import { parseBackupKey } from "@/lib/backup-core";
import { db } from "@/lib/db";

async function main() {
  const file = process.argv[2];
  if (!file || file.startsWith("-")) {
    console.error("Uso: restore-backup <fichero.pzbak>   (variables: DATABASE_URL, BACKUP_KEY)");
    process.exitCode = 2;
    return;
  }
  const key = parseBackupKey(process.env.BACKUP_KEY);
  if (!key) {
    console.error("BACKUP_KEY no está definida o no es válida (32 bytes en base64).");
    process.exitCode = 2;
    return;
  }
  const manifest = await restoreDatabase(db, file, key, (m) => console.log(`[restore] ${m}`));
  console.log(`[restore] Hecho: ${manifest.totalRows} filas en ${manifest.tables.length} tablas (copia del ${manifest.createdAt}).`);
}

main()
  .catch((err) => {
    console.error("[restore] ERROR:", err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
