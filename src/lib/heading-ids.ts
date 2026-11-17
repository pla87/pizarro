import { slugify } from "./search-accents";

// Identificadores de los títulos del visor de Markdown de la Documentación, para que un enlace «otro.md#apartado» (desde
// un HTML de la misma Documentación) llegue al apartado. El identificador es el de los títulos de la web
// (site-markdown.ts): sin tildes, minúsculas y guiones («Instalación rápida» → «instalacion-rapida»), «-2», «-3»… si se
// repite. Va con un prefijo para que un título no pueda dar a un elemento un id que choque con otro de la app (ni con
// las variables globales que el navegador crea por cada id).

const HEADING_ID_PREFIX = "md-";

type HastNode = { type: string; tagName?: string; value?: string; properties?: Record<string, unknown>; children?: HastNode[] };

const HEADING = /^h[1-6]$/;

function textOf(node: HastNode): string {
  if (node.type === "text") return node.value ?? "";
  return (node.children ?? []).map(textOf).join("");
}

/** Plugin de rehype (react-markdown): pone `id` a cada título. */
export function rehypeHeadingIds() {
  return (tree: HastNode) => {
    const taken = new Set<string>();
    const walk = (node: HastNode) => {
      if (node.type === "element" && node.tagName && HEADING.test(node.tagName)) {
        const base = slugify(textOf(node)) || "seccion";
        let id = base;
        for (let n = 2; taken.has(id); n++) id = `${base}-${n}`;
        taken.add(id);
        node.properties = { ...node.properties, id: `${HEADING_ID_PREFIX}${id}` };
        return;
      }
      node.children?.forEach(walk);
    };
    walk(tree);
  };
}

/**
 * Id del título al que apunta un «#apartado» de la dirección. Admite el apartado tal como se escribe a mano o como lo
 * generan otras herramientas (con tildes, mayúsculas o codificado: «#Instalaci%C3%B3n-r%C3%A1pida»), porque se pasa por
 * el mismo slug. Null si no hay apartado.
 */
export function headingIdForHash(hash: string): string | null {
  let fragment = hash.replace(/^#/, "");
  try {
    fragment = decodeURIComponent(fragment);
  } catch {
    // Mal codificado: se usa tal cual.
  }
  const slug = slugify(fragment);
  return slug ? `${HEADING_ID_PREFIX}${slug}` : null;
}
