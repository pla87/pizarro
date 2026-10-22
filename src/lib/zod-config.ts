import { z } from "zod";

// En el navegador, zod compila los validadores con `new Function` (JIT) y antes lo prueba con
// `Function("")`: con la CSP estricta (sin 'unsafe-eval') eso genera una violación en consola.
// En el cliente se desactiva el JIT (los esquemas son pequeños); en el servidor se deja como está.
// Debe importarse ANTES de crear cualquier esquema («import "./zod-config"» en primer lugar).
if (typeof window !== "undefined") z.config({ jitless: true });
