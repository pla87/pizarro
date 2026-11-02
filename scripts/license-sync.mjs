// Genera src/lib/license-text.ts a partir de LICENSE.md (fuente única: español, «---» y traducción al inglés).
// Uso: npm run license:sync. La prueba tests/license.test.ts comprueba que no se desincronizan.
import { readFileSync, writeFileSync } from "node:fs";

export const SEPARATOR = "\n\n---\n\n";
const root = new URL("../", import.meta.url);
const md = readFileSync(new URL("LICENSE.md", root), "utf8").replace(/\r\n/g, "\n").trimEnd();
const parts = md.split(SEPARATOR);
if (parts.length !== 2) throw new Error("LICENSE.md debe tener exactamente un separador «---» entre el español y el inglés");
const lit = (s) => "`" + s.replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$\{/g, "\\${") + "`";
const out = `// GENERADO por scripts/license-sync.mjs a partir de LICENSE.md: no editar a mano (npm run license:sync).
// Texto de la licencia (Markdown) en español, que prevalece, y su traducción al inglés, para la página pública /licencia.
export const LICENSE_ES = ${lit(parts[0])};

export const LICENSE_EN = ${lit(parts[1])};
`;
writeFileSync(new URL("src/lib/license-text.ts", root), out);
