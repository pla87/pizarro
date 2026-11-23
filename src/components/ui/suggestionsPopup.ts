import { suggestionsPlacement } from "@/lib/popup-place";

/** Ancho de la lista de sugerencias de «@» (`w-72`). */
const WIDTH = 288;

/**
 * Estilo (posición fija) de la lista de sugerencias de «@» junto al cursor, para pintarla en un portal sobre `<body>`:
 * así no la corta el borde del diálogo, y se abre hacia arriba cuando debajo no cabe (suggestionsPlacement).
 */
export function suggestionsStyle(caret: { top: number; bottom: number; left: number }, options: readonly { kind: string }[]): React.CSSProperties {
  const vv = window.visualViewport;
  const top = vv?.offsetTop ?? 0;
  const view = { top, bottom: top + (vv?.height ?? window.innerHeight), width: window.innerWidth, height: window.innerHeight };
  // Alto de cada opción (medido en Chromium): 36 px por persona (avatar de 24 y una línea), 48 por orden de Google (dos
  // líneas: nombre y ayuda) y 32 de la línea de ayuda de abajo, el relleno y el borde. Con 40 para todas, las tres órdenes y la
  // ayuda no cabían en lo previsto y la lista se abría hacia abajo y quedaba con barra de desplazamiento.
  const wanted = options.reduce((h, o) => h + (o.kind === "command" ? 48 : 36), 32);
  return { position: "fixed", ...suggestionsPlacement(caret, view, wanted, WIDTH) };
}

/**
 * `ref` de la opción activa: al cambiarla con ↑↓ se desplaza la lista hasta ella (sin mover nada más si ya se ve). Si no
 * cabe entera, la lista tiene barra de desplazamiento y la opción elegida con el teclado quedaba fuera de la vista.
 */
export function scrollActiveOption(el: HTMLElement | null): void {
  el?.scrollIntoView({ block: "nearest" });
}
