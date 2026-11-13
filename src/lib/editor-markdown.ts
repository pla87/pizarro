import { getSchema } from "@tiptap/core";
import { MarkdownManager } from "@tiptap/markdown";
import { formatExtensions } from "./editor-extensions";
import { MentionChip } from "./editor-mention";
import { keepUntouchedMarkdown } from "./markdown-keep";
import { blankEmptyParagraphs, normalizeEditorMarkdown } from "./markdown-entities";

// Cómo escribe el editor con barra (RichTextEditor) un trozo de Markdown: se lee con sus mismas extensiones y se vuelve a
// escribir, igual que al abrirlo y guardarlo (onUpdate). Sin DOM: lo usa la release para saber qué bloques no se han tocado
// (markdown-keep.ts). Pesa lo que TipTap: solo se importa desde código que ya carga el editor.

const extensions = [...formatExtensions(), MentionChip] as never;
let manager: MarkdownManager | null = null;
let schema: ReturnType<typeof getSchema> | null = null;

// Los bloques de una release se repiten entre lecturas (solo cambia lo que se edita): se recuerdan.
const cache = new Map<string, string>();
const CACHE_MAX = 5000;

/** Markdown tal como lo guardaría el editor con barra. Si no lo puede leer, el propio texto (nunca coincidirá con nada). */
export function editorMarkdown(md: string): string {
  const hit = cache.get(md);
  if (hit !== undefined) return hit;
  manager ??= new MarkdownManager({ extensions });
  schema ??= getSchema(extensions);
  let out: string;
  try {
    out = normalizeEditorMarkdown(manager.serialize(schema.nodeFromJSON(manager.parse(md)).toJSON()));
  } catch {
    out = `\u0000${md}`;
  }
  if (cache.size >= CACHE_MAX) cache.clear();
  cache.set(md, out);
  return out;
}

/**
 * Texto de la release tras editarla con el editor con barra: `raw` es lo que escribe el editor (getMarkdown) y `base`, el
 * texto que se cargó en él. Los bloques no tocados conservan su texto exacto (markdown-keep.ts); en lo editado, los
 * párrafos vacíos («&nbsp;» y las líneas en blanco de más con que TipTap los guarda) quedan en una sola línea en blanco,
 * como se ven en el editor y como saldrían con el editor Markdown (Copiar todo, .md, .txt y lo que se guarda).
 */
export function releaseFromEditor(base: string, raw: string): string {
  const edited = blankEmptyParagraphs(normalizeEditorMarkdown(raw), { all: true });
  return keepUntouchedMarkdown(base, edited, (md) => blankEmptyParagraphs(editorMarkdown(md), { all: true }));
}
