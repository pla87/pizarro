// Copiar y pegar la tarea abierta como JSON (formato en lib/task-json.ts): reglas del teclado y del portapapeles que
// usa el detalle de la tarea (TaskDialog).

/** ¿Hay texto seleccionado (en un campo o en la página)? Entonces Ctrl+C copia ese texto, como siempre. */
export function hasTextSelection(): boolean {
  const a = document.activeElement;
  if (a instanceof HTMLInputElement || a instanceof HTMLTextAreaElement) {
    try {
      // Los campos sin texto (casillas, fechas…) no tienen selección: dan null o lanzan.
      if (a.selectionStart !== null && a.selectionEnd !== null && a.selectionStart !== a.selectionEnd) return true;
    } catch {
      // sin selección propia: se mira la de la página
    }
  }
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed) return false;
  if (sel.toString().length > 0) return true;
  // Sin texto pero con contenido: una imagen sola (seleccionada en la descripción, al leerla o al editarla), una tabla
  // vacía, una línea… también se copian como siempre.
  for (let i = 0; i < sel.rangeCount; i++) {
    if (sel.getRangeAt(i).cloneContents().querySelector(SELECTABLE_CONTENT)) return true;
  }
  return false;
}

/** Contenido sin texto que se puede seleccionar y copiar. */
const SELECTABLE_CONTENT = "img, picture, video, audio, canvas, svg, table, hr";

/** Tipos de <input> en los que se escribe (y se pega) texto; los demás (casilla, fecha, color, archivo…) no lo admiten. */
const TYPING_INPUT_TYPES: ReadonlySet<string> = new Set(["text", "search", "url", "tel", "email", "password", "number"]);

/**
 * ¿El pegado va a una caja donde se escribe texto (campo, área de texto o editor)? Ahí el JSON de una tarea se pega como
 * texto. Una casilla de subtarea, la fecha o un selector de color también son <input>, pero no admiten texto pegado: con
 * el foco en ellos, Ctrl+V es «fuera de un campo de texto» y pega la tarea.
 */
export function acceptsPastedText(target: EventTarget | null): boolean {
  const el = target instanceof Element ? target.closest("input, textarea, [contenteditable=true], [contenteditable='']") : null;
  if (!el) return false;
  return el instanceof HTMLInputElement ? TYPING_INPUT_TYPES.has(el.type) : true;
}

/**
 * ¿Este evento (tecla o pegado) es para `dialog`? Sí si el foco está dentro de él; si está dentro de otro diálogo
 * (confirmación, visor de imágenes, la otra tarea abierta al lado), no; y con el foco fuera de todos, solo el último abierto.
 */
export function eventIsFor(dialog: Element | null | undefined, target: EventTarget | null): boolean {
  if (!dialog) return false;
  const el = target instanceof Element ? target : target instanceof Node ? target.parentElement : null;
  const holder = el?.closest("[role=dialog]");
  if (holder) return holder === dialog;
  const all = document.querySelectorAll("[role=dialog]");
  return all[all.length - 1] === dialog;
}

/** Ctrl+C (⌘C en Mac) sin más modificadores. */
export function isCopyKey(e: KeyboardEvent): boolean {
  return (e.ctrlKey || e.metaKey) && !(e.ctrlKey && e.metaKey) && !e.altKey && !e.shiftKey && !e.repeat && (e.key === "c" || e.key === "C" || e.code === "KeyC");
}

/**
 * Copia un texto que aún se está pidiendo al servidor. Safari solo deja escribir en el portapapeles dentro del gesto
 * (la tecla o el clic), así que se le entrega ya la promesa (ClipboardItem); donde eso no existe o falla, se espera al
 * texto y se copia como siempre. `false` si no se pudo.
 */
export async function copyTextLater(text: Promise<string>, fallback: (text: string) => Promise<boolean>): Promise<boolean> {
  try {
    if (typeof ClipboardItem !== "undefined" && navigator.clipboard?.write) {
      await navigator.clipboard.write([new ClipboardItem({ "text/plain": text.then((s) => new Blob([s], { type: "text/plain" })) })]);
      return true;
    }
  } catch {
    // Sin permiso para esta vía (o el texto no llegó): se intenta la de siempre con el texto ya resuelto.
  }
  let value: string;
  try {
    value = await text;
  } catch {
    return false;
  }
  return fallback(value);
}

/** Lee el texto del portapapeles (menú «Pegar tarea»). `null` si el navegador no lo permite o la persona lo rechaza. */
export async function readClipboardText(): Promise<string | null> {
  try {
    if (!navigator.clipboard?.readText) return null;
    return await navigator.clipboard.readText();
  } catch {
    return null;
  }
}
