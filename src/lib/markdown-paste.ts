// Detecta si un texto plano pegado «parece» Markdown (para convertirlo en el editor con formato).

const MARKDOWN_HINT =
  /(\*\*[^*\n]+\*\*|~~[^~\n]+~~|\+\+[^+\n]+\+\+|(?<![\w*])\*[^*\s][^*\n]*\*(?![\w*])|`[^`\n]+`|\[[^\]\n]+\]\([^)\s]+\)|^\s{0,3}#{1,6}\s+\S|^\s*[-*+]\s+\S|^\s*\d+[.)]\s+\S|^\s*>\s+\S)/m;

export function looksLikeMarkdown(text: string): boolean {
  return MARKDOWN_HINT.test(text);
}

/** Etiquetas que solo envuelven texto: no aportan formato (los teclados y navegadores móviles las añaden al copiar texto plano). */
const WRAPPER_TAGS = new Set(["html", "head", "body", "meta", "title", "div", "span", "p", "br", "font"]);

/** Estilos en línea que sí son formato real (negrita, cursiva, subrayado, tachado). */
const FORMAT_STYLE = /font-weight\s*:\s*(bold|[6-9]00)|font-style\s*:\s*italic|text-decoration[^;"']*(underline|line-through)/i;

/**
 * ¿Este HTML del portapapeles es solo texto envuelto (div/span/p/br/meta) sin formato real?
 * Con listas, títulos, enlaces, negrita, código, tablas o imágenes devuelve false.
 */
export function isPlainWrapperHtml(html: string): boolean {
  const body = html.replace(/<!--[\s\S]*?-->/g, "").replace(/<(style|script)\b[\s\S]*?<\/\1\s*>/gi, "");
  const tag = /<\/?([a-zA-Z][a-zA-Z0-9-]*)\b([^>]*)>/g;
  for (let m = tag.exec(body); m; m = tag.exec(body)) {
    if (!WRAPPER_TAGS.has(m[1]!.toLowerCase())) return false;
    if (FORMAT_STYLE.test(m[2]!)) return false;
  }
  return true;
}

/**
 * Decide si un pegado debe tratarse como Markdown: hay texto plano que lo parece y el HTML (si lo hay)
 * no lleva formato real. Devuelve el texto a interpretar, o null para dejar el pegado normal.
 */
export function markdownFromPaste(plain: string, html: string): string | null {
  if (!plain || !looksLikeMarkdown(plain)) return null;
  if (html && !isPlainWrapperHtml(html)) return null;
  return plain;
}
