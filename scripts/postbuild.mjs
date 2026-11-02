// Tras `next build`:
// 1. Empaqueta el worker de los PDF (src/lib/report-pdf-worker.ts) con @react-pdf/renderer y todas sus dependencias en
//    un solo fichero, dist/pdf-worker.mjs: el servidor de Next no carga @react-pdf (solo le pasa datos al worker), así
//    que el standalone no lo incluye. En Docker, dist/ se copia entero a la imagen (Dockerfile); para `npm start`, el
//    fichero se copia también a .next/standalone/dist (server.js se ejecuta desde esa carpeta).
// 2. Copia los recursos estáticos dentro de .next/standalone para `npm start` (en Docker se copian en el propio Dockerfile).
import { cpSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { build } from "esbuild";

// pdfkit carga las 14 fuentes estándar (Helvetica…) con un require() creado en tiempo de ejecución
// (createRequire + "#standard-fonts/…"), que esbuild no puede seguir: sin esto, el worker empaquetado las buscaría en
// un node_modules que la imagen no tiene. Se cambian por imports normales (unos 190 KB) para que queden dentro.
const pdfkitStandardFonts = {
  name: "pdfkit-standard-fonts",
  setup(b) {
    b.onLoad({ filter: /[\\/]pdfkit[\\/]js[\\/]pdfkit\.node\.mjs$/ }, (args) => {
      const imports = [];
      const contents = readFileSync(args.path, "utf8").replace(/\brequire\$1\('#standard-fonts\/(\w+)'\)/g, (_, font) => {
        imports.push(`import __pdfkitFont_${font} from "pdfkit/standard-fonts/${font}";`);
        return `__pdfkitFont_${font}`;
      });
      if (imports.length !== 14) throw new Error(`pdfkit: se esperaban 14 fuentes estándar y hay ${imports.length}; revisa este plugin`);
      return { contents: `${imports.join("\n")}\n${contents}`, loader: "js" };
    });
  },
};

await build({
  entryPoints: ["src/lib/report-pdf-worker.ts"],
  outfile: "dist/pdf-worker.mjs",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  // React en modo producción (más rápido y sin avisos de desarrollo).
  define: { "process.env.NODE_ENV": '"production"' },
  // Algunas dependencias usan require() de CommonJS: en ESM hay que crearlo.
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
  legalComments: "none",
  logLevel: "warning",
  plugins: [pdfkitStandardFonts],
});

mkdirSync(".next/standalone/dist", { recursive: true });
cpSync("dist/pdf-worker.mjs", ".next/standalone/dist/pdf-worker.mjs");
cpSync(".next/static", ".next/standalone/.next/static", { recursive: true });
if (existsSync("public")) cpSync("public", ".next/standalone/public", { recursive: true });
