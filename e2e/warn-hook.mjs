// Se carga con NODE_OPTIONS="--import <ruta>/e2e/warn-hook.mjs" (install-e2e.mjs): anota cada aviso de Node (DeprecationWarning
// incluido) con su pila en WARN_LOG, para localizarlo aunque el proceso no tenga salida visible. Sin WARN_LOG no hace nada.
import fs from "node:fs";

const out = process.env.WARN_LOG;
if (out) {
  process.on("warning", (w) => {
    try {
      fs.appendFileSync(out, `[${process.pid} ${new Date().toISOString()}] ${w.name}: ${w.message}\n${w.stack}\n\n`);
    } catch {
      // El registro de avisos nunca debe romper el proceso.
    }
  });
}
