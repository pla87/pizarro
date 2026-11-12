// Alt+N y Alt+Mayús+N recién abierto el tablero: hasta que React hidrata la página (alrededor de un segundo en un
// tablero grande o un equipo lento) los atajos no existen y la pulsación se perdía. Un script mínimo, incluido en el
// HTML del tablero (con el nonce de la CSP), la anota; al montar, useBoardShortcuts la recoge y la ejecuta.
// Módulo sin "use client": lo usan la página (servidor) y el gancho de atajos (cliente).

/** Lo que deja anotado el script: la última pulsación y cómo quitar su escucha. */
interface EarlyShortcut {
  key: "new" | "bulk" | null;
  off: () => void;
}

/** Elementos donde se está escribiendo: los atajos de una tecla no deben dispararse. Lo usan el script de antes de hidratar
 *  y los atajos de React (shortcuts.ts, isTypingTarget), para que los dos decidan igual. */
export const TYPING_SELECTOR = "input, textarea, select, [contenteditable=true], [contenteditable='']";

/** Script en línea (texto). Ignora lo que se escribe en campos y las pulsaciones con Ctrl/⌘ o repetidas. */
export const EARLY_SHORTCUT_SCRIPT = `(function(){var w=window;if(w.__pzEarlyShortcut)return;var f=function(e){if(!e.altKey||e.ctrlKey||e.metaKey||e.repeat||e.code!=="KeyN")return;var t=e.target;if(t&&t.closest&&t.closest(${JSON.stringify(TYPING_SELECTOR)}))return;e.preventDefault();s.key=e.shiftKey?"bulk":"new"};var s={key:null,off:function(){document.removeEventListener("keydown",f)}};w.__pzEarlyShortcut=s;document.addEventListener("keydown",f)})()`;

/** Recoge (una sola vez) la pulsación anotada antes de hidratar y retira la escucha provisional. */
export function takeEarlyShortcut(): EarlyShortcut["key"] {
  const w = window as unknown as { __pzEarlyShortcut?: EarlyShortcut };
  const early = w.__pzEarlyShortcut;
  if (!early) return null;
  early.off();
  delete w.__pzEarlyShortcut;
  return early.key;
}
