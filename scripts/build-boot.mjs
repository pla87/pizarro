// `npm run build:boot`: los scripts de línea de órdenes de dist/ (boot, restore, rotate-keys, doctor y reset-link), de
// una vez y con lo común en trozos compartidos (dist/chunk-*.mjs). Antes cada uno se empaquetaba solo y llevaba su copia
// de todo (Prisma, el cliente generado, las copias…): ~24 MB en dist/; ahora, unos 7. Los nombres de entrada no cambian:
// `node dist/restore.mjs`, `node dist/reset-link.mjs`… (y `import("dist/boot.mjs")` en scripts/start-local.mjs) siguen
// igual, en local, en la imagen Docker (copia dist/ entera) y en Railway. Los trozos van en dist/ mismo, junto a las
// entradas: lo que mira su propia ruta (import.meta.url: el cliente de Prisma, restore.ts) sigue viendo la misma carpeta.
// dist/pdf-worker.mjs es aparte (scripts/postbuild.mjs): no se toca. Pruebas: tests/docker-build.test.ts.
import { readdirSync, rmSync } from "node:fs";
import path from "node:path";
import { build } from "esbuild";

const BOOT_ENTRIES = ["boot", "restore", "rotate-keys", "doctor", "reset-link"];
const OUT = "dist";

// Los trozos de una compilación anterior (chunk-HASH.mjs y los de import() dinámico, nombre-HASH.mjs: el hash de esbuild
// son 8 letras mayúsculas o cifras): sin esto, dist/ los iría acumulando. Las entradas y pdf-worker.mjs no llevan hash.
try {
  for (const f of readdirSync(OUT)) if (/-[A-Z0-9]{8}\.mjs$/.test(f)) rmSync(path.join(OUT, f));
} catch {
  /* sin dist/ todavía */
}

await build({
  entryPoints: BOOT_ENTRIES.map((name) => `scripts/${name}.ts`),
  outdir: OUT,
  outExtension: { ".js": ".mjs" },
  bundle: true,
  splitting: true,
  platform: "node",
  format: "esm",
  target: "node22",
  // Algunas dependencias usan require() de CommonJS: en ESM hay que crearlo (en cada fichero, también en los trozos).
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
  logLevel: "warning",
});
