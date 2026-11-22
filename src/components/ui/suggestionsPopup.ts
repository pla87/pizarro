import { suggestionsPlacement } from "@/lib/popup-place";

/** Ancho de la lista de sugerencias de «@» (`w-72`). */
const WIDTH = 288;

/**
 * Estilo (posición fija) de la lista de sugerencias de «@» junto al cursor, para pintarla en un portal sobre `<body>`:
 * así no la corta el borde del diálogo, y se abre hacia arriba cuando debajo no cabe (suggestionsPlacement).
 */
export function suggestionsStyle(caret: { top: number; bottom: number; left: number }, count: number): React.CSSProperties {
  const vv = window.visualViewport;
  const top = vv?.offsetTop ?? 0;
  const view = { top, bottom: top + (vv?.height ?? window.innerHeight), width: window.innerWidth, height: window.innerHeight };
  // Alto aproximado: 40 px por opción y la línea de ayuda de abajo.
  return { position: "fixed", ...suggestionsPlacement(caret, view, count * 40 + 30, WIDTH) };
}
