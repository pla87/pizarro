import type { EditResult } from "@/lib/markdown-edit";
import { attachablePasteFiles } from "./pasteFiles";

/**
 * Aplica una edición al textarea conservando el historial de deshacer del navegador (Ctrl+Z): se reemplaza solo el tramo
 * que cambia con `execCommand`, que dispara el evento `input` y, con él, el onChange de React. Si el navegador no lo admite,
 * se asigna el valor entero por `onValueChange`.
 */
export function applyTextareaEdit(el: HTMLTextAreaElement | HTMLInputElement, edit: EditResult, onValueChange: (v: string) => void): void {
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

/**
 * Pegado en un campo de una sola línea (título, subtarea): los saltos de línea pasan a ser un espacio. El navegador los
 * quitaba sin más en un <input> («Primera línea\nsegunda» quedaba «Primera líneasegunda»).
 */
export function pasteAsOneLine(e: React.ClipboardEvent<HTMLInputElement | HTMLTextAreaElement>, onValueChange: (v: string) => void): void {
  const text = e.clipboardData.getData("text/plain");
  // Con archivos que adjuntar, el pegado es del diálogo (ui/pasteFiles), no del campo.
  if (!/[\r\n]/.test(text) || attachablePasteFiles(e.nativeEvent).length) return;
  e.preventDefault();
  const el = e.currentTarget;
  const flat = text.replace(/\s*[\r\n]+\s*/g, " ").trim();
  const start = el.selectionStart ?? el.value.length;
  const end = el.selectionEnd ?? el.value.length;
  const max = el.maxLength >= 0 ? el.maxLength : Infinity;
  const insert = flat.slice(0, Math.max(0, max - (el.value.length - (end - start))));
  const value = el.value.slice(0, start) + insert + el.value.slice(end);
  applyTextareaEdit(el, { value, start: start + insert.length, end: start + insert.length }, onValueChange);
}
