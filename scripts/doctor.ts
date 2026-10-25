// Diagnóstico para soporte desde la línea de órdenes (pensado para Docker): imprime en la salida estándar el mismo
// informe JSON que Administración → Ajustes → «Descargar diagnóstico». Sin datos personales ni secretos.
//
//   docker compose exec app node dist/doctor.mjs > diagnostico.json
//   (en desarrollo: npm run doctor)
import { db } from "@/lib/db";
import { collectDiagnostics } from "@/lib/doctor";

collectDiagnostics({ source: "cli" })
  .then((report) => {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  })
  .catch((err) => {
    console.error("[doctor] ERROR:", err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
