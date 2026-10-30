import type { EditResult } from "@/lib/markdown-edit";

/**
 * Aplica una edición al textarea conservando el historial de deshacer del navegador (Ctrl+Z): se reemplaza solo el tramo
 * que cambia con `execCommand`, que dispara el evento `input` y, con él, el onChange de React. Si el navegador no lo admite,
 * se asigna el valor entero por `onValueChange`.
 */
export function applyTextareaEdit(el: HTMLTextAreaElement, edit: EditResult, onValueChange: (v: string) => void): void {
  const old = el.value;
  const next = edit.value;
  if (old !== next) {
    let a = 0;
    while (a < old.length && a < next.length && old[a] === next[a]) a++;
    let b = 0;
    while (b < old.length - a && b < next.length - a && old[old.length - 1 - b] === next[next.length - 1 - b]) b++;
    const insert = next.slice(a, next.length - b);
    el.focus();
    el.setSelectionRange(a, old.length - b);
    let ok = false;
    try {
      ok = insert ? document.execCommand("insertText", false, insert) : document.execCommand("delete");
    } catch {
      ok = false;
    }
    if (!ok || el.value !== next) {
      el.value = next;
      onValueChange(next);
    }
  }
  el.setSelectionRange(edit.start, edit.end);
}
