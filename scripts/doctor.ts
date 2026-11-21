// Diagnóstico para soporte desde la línea de órdenes (pensado para Docker): imprime en la salida estándar el mismo
// informe JSON que Administración → Ajustes → «Descargar diagnóstico». Sin datos personales ni secretos.
//
//   docker compose exec app node dist/doctor.mjs > diagnostico.json
//   (en desarrollo: npm run doctor)
import { applyAppUrlFallback } from "@/lib/app-url";
import { db } from "@/lib/db";
import { collectDiagnostics } from "@/lib/doctor";

// Como la app: sin APP_URL, la dirección pública de Railway (así el informe dice lo mismo que el de Administración).
applyAppUrlFallback(process.env, null);
collectDiagnostics({ source: "cli" })
  .then((report) => {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    // Los avisos también en la terminal (la salida estándar suele ir a un fichero).
    for (const w of (report.warnings as { text: string }[] | undefined) ?? []) console.error(`[doctor] AVISO: ${w.text}`);
  })
  .catch((err) => {
    console.error("[doctor] ERROR:", err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
