// Subrayado en Markdown: ++texto++. Se transforma en un enlace interno [texto](#u)
// que el renderizador (Markdown.tsx) pinta como <u>. Código y bloques de código no se tocan.

export const UNDERLINE_HREF = "#u";

// Bloques de código (``` o ~~~) y código en línea: se saltan tal cual.
const CODE_RE = /((?:^|\n)(```|~~~)[\s\S]*?(?:\n\2|$)|(`+)[^`]+?\3)/g;
// ++x++ sin espacios en los bordes y sin letras/+ pegados por fuera (así «c++» o «a++b++c» no cuentan).
const UNDERLINE_RE = /(?<![\w+])\+\+(?=[^\s+])([^\n[\]]*?[^\s+])\+\+(?![\w+])/g;

export function underlineToLink(text: string): string {
  let out = "";
  let last = 0;
  for (const m of text.matchAll(CODE_RE)) {
    out += underlineChunk(text.slice(last, m.index)) + m[0];
    last = m.index + m[0].length;
  }
  return out + underlineChunk(text.slice(last));
}

function underlineChunk(chunk: string): string {
  return chunk.replace(UNDERLINE_RE, (_m, inner: string) => `[${inner}](${UNDERLINE_HREF})`);
}
