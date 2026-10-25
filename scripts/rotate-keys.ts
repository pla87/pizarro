// Vuelve a cifrar con ENCRYPTION_KEY todos los secretos guardados (TOTP y tokens de Google) que sigan cifrados
// con la clave anterior (ENCRYPTION_KEY_PREVIOUS) o en el formato antiguo. Después se puede quitar la anterior.
//
//   npm run keys:rotate [-- --dry-run]
//   (en el contenedor ya compilado: node dist/rotate-keys.mjs [--dry-run])
//
// Variables: DATABASE_URL, SESSION_SECRET, ENCRYPTION_KEY y ENCRYPTION_KEY_PREVIOUS (las mismas que la app).
// Se puede ejecutar con la app en marcha y repetir sin peligro.
import { db } from "@/lib/db";
import { encryptionKeys } from "@/lib/keyring";
import { rotateEncryptedSecrets, type RotationDb } from "@/lib/key-rotation";

async function main() {
  const args = process.argv.slice(2);
  const unknown = args.filter((a) => a !== "--dry-run");
  if (unknown.length) {
    console.error("Uso: rotate-keys [--dry-run]   (variables: DATABASE_URL, SESSION_SECRET, ENCRYPTION_KEY, ENCRYPTION_KEY_PREVIOUS)");
    process.exitCode = 2;
    return;
  }
  const dryRun = args.includes("--dry-run");
  const { current, previous } = encryptionKeys();
  console.log(`[keys] Clave actual: ${current.id}${process.env.ENCRYPTION_KEY ? " (ENCRYPTION_KEY)" : " (derivada de SESSION_SECRET)"}`);
  console.log(`[keys] Clave anterior: ${previous ? previous.id + " (ENCRYPTION_KEY_PREVIOUS)" : "ninguna"}`);
  const counts = await rotateEncryptedSecrets(db as unknown as RotationDb, { dryRun });
  let unreadable = 0;
  for (const c of counts) {
    unreadable += c.unreadable;
    console.log(`[keys] ${c.label}: ${c.total} en total, ${c.current} ya al día, ${c.rotated} ${dryRun ? "por re-cifrar" : "re-cifrados"}, ${c.unreadable} ilegibles.`);
  }
  if (unreadable > 0) {
    console.log("[keys] AVISO: hay secretos que ninguna clave configurada abre. Si tienes la clave con la que se cifraron,");
    console.log("[keys] ponla en ENCRYPTION_KEY_PREVIOUS y repite. Si no, esas personas tendrán que volver a configurar la");
    console.log("[keys] verificación en dos pasos (un administrador la restablece) o reconectar Google.");
    process.exitCode = 3;
  } else if (!dryRun) {
    console.log(previous ? "[keys] Hecho. Ya puedes quitar ENCRYPTION_KEY_PREVIOUS." : "[keys] Hecho.");
  }
}

main()
  .catch((err) => {
    console.error("[keys] ERROR:", err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
