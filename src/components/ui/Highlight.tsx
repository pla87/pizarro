import { highlightParts, SEARCH_HIT_CLASS } from "@/lib/search-highlight";

/**
 * Texto con lo buscado resaltado en <mark> (sin distinguir mayúsculas ni tildes, como la búsqueda). Sin búsqueda o sin
 * coincidencias, el texto tal cual. Sin "use client": vale en los dos lados.
 */
export function Highlight({ text, query }: { text: string; query: string }) {
  if (!query) return text;
  const parts = highlightParts(text, query);
  if (parts.length === 1 && !parts[0]!.hit) return text;
  return parts.map((p, i) => (p.hit ? <mark key={i} className={SEARCH_HIT_CLASS}>{p.text}</mark> : p.text));
}
