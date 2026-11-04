// El editor con barra (TipTap) guarda `<`, `>` y `&` como entidades HTML (`&lt;`, `&gt;`, `&amp;`)
// para que no se confundan con HTML. Pizarro no interpreta HTML en el Markdown, así que se guardan
// los caracteres tal cual los escribió la persona; solo se conserva la entidad donde el carácter
// cambiaría el significado (un `>` al principio de línea sería una cita; `<letra` parecería HTML).

const ENTITY: Record<string, string> = { lt: "<", gt: ">", amp: "&", quot: '"', "#39": "'", apos: "'", nbsp: " " };

/** Todas las entidades a su carácter (para textos planos como la release). */
export function decodeEntities(text: string): string {
  return text.replace(/&(lt|gt|amp|quot|#39|apos|nbsp);/g, (m, name: string) => ENTITY[name] ?? m);
}

/** Fuera de bloques de código: decodifica salvo donde cambiaría el Markdown. */
function decodeProse(text: string): string {
  return text
    .replace(/&lt;(?![A-Za-z/!?])/g, "<")
    .replace(/(^|\n)([ \t]*(?:[-*+] |\d+[.)] )?)&gt;/g, "$1$2\\>")
    .replace(/&gt;/g, ">")
    .replace(/&amp;(?!#?\w+;)/g, "&");
}

/** Markdown que sale del editor con barra → Markdown con los caracteres reales. */
export function normalizeEditorMarkdown(raw: string): string {
  // Lo que sobra al final: TipTap guarda cada párrafo vacío como «&nbsp;» y un salto de línea como dos espacios; tras pegar
  // queda un párrafo vacío detrás y la descripción se guardaba con «  \n\n\n» o «&nbsp;» al final.
  const md = raw.replace(/(?:\s|&nbsp;)+$/, "");
  if (!md.includes("&")) return md;
  // Bloques ``` y código en línea: el editor no los codifica (TipTap deja el código tal cual), así que se guardan como
  // están. Decodificarlos convertía un `&amp;` o un `&nbsp;` escrito en un fragmento de código en `&` o en un espacio.
  return md
    .split(/(```[\s\S]*?```|`[^`\n]+`)/g)
    .map((part, i) => (i % 2 === 1 ? part : decodeProse(part)))
    .join("");
}
