/** Alto máximo de una lista de sugerencias de «@» (`max-h-64`). */
const SUGGESTIONS_MAX_HEIGHT = 256;

/**
 * Dónde va la lista de sugerencias de «@» junto al cursor (posición fija, en píxeles de la ventana): debajo si cabe la
 * altura que necesita (`wanted`); si no, del lado con más sitio, encima del cursor si es ese. Siempre dentro de la parte
 * visible (`view`: con el teclado del móvil abierto, lo que queda por encima de él), con un margen de 8 px, y con el alto
 * máximo recortado a lo que haya. Antes iba siempre debajo y el borde del diálogo (o de la pantalla) la cortaba.
 */
export function suggestionsPlacement(
  caret: { top: number; bottom: number; left: number },
  view: { top: number; bottom: number; width: number; height: number },
  wanted: number,
  width: number,
): { top?: number; bottom?: number; left: number; maxHeight: number } {
  const margin = 8;
  const gap = 4;
  const need = Math.min(wanted, SUGGESTIONS_MAX_HEIGHT);
  const below = view.bottom - caret.bottom - gap - margin;
  const above = caret.top - view.top - gap - margin;
  const left = Math.max(margin, Math.min(caret.left, view.width - width - margin));
  if (below >= need || below >= above) return { top: caret.bottom + gap, left, maxHeight: Math.max(0, Math.min(SUGGESTIONS_MAX_HEIGHT, below)) };
  // Encima: anclada por abajo (con `bottom`), así una lista más corta de lo previsto sigue pegada al cursor.
  return { bottom: view.height - caret.top + gap, left, maxHeight: Math.min(SUGGESTIONS_MAX_HEIGHT, above) };
}
