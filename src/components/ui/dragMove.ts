"use client";

/**
 * Arrastrar texto seleccionado de un campo a otro: se MUEVE (se borra del origen) y, con Ctrl, se COPIA
 * (en Mac también con Alt/Option, la tecla nativa de copiar). Chromium ya lo hace entre inputs y textareas, pero no
 * cuando el destino es el editor TipTap (ProseMirror gestiona el drop y el origen se queda con el texto).
 *
 * Mecanismo: al empezar el arrastre se recuerda el campo de origen y su selección; si se suelta en OTRO campo
 * nuestro sin tecla de copiar y, al terminar, el origen sigue exactamente igual (el navegador no lo borró), se
 * borra el trozo arrastrado y se avisa a React. Fuera de nuestros campos (tarjetas de dnd-kit, ficheros, otras
 * zonas) no se hace nada.
 */
import type { Editor } from "@tiptap/core";
import type { Slice } from "@tiptap/pm/model";

const editors = new WeakMap<Element, Editor>();

/** El editor TipTap se registra por su elemento DOM para poder borrar su selección al mover texto. */
export function registerDragEditor(editor: Editor): () => void {
  const dom = editor.view.dom;
  editors.set(dom, editor);
  return () => {
    if (editors.get(dom) === editor) editors.delete(dom);
  };
}

type Source =
  | { kind: "field"; el: HTMLInputElement | HTMLTextAreaElement; start: number; end: number; value: string; dropped: boolean; copy: boolean }
  | { kind: "editor"; editor: Editor; from: number; to: number; docJson: string; slice: Slice; dropped: boolean; copy: boolean };

const TEXT_INPUT_TYPES = new Set(["text", "search", "url", "tel", "email", "password", ""]);

const isMac = () => typeof navigator !== "undefined" && /Mac|iPhone|iPad/i.test(navigator.platform || navigator.userAgent);

function elementOf(node: EventTarget | null): Element | null {
  if (!(node instanceof Node)) return null;
  return node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
}

/** Campo de texto (input, textarea o editor TipTap) al que pertenece el nodo, si lo hay. */
function fieldOf(node: EventTarget | null): HTMLInputElement | HTMLTextAreaElement | HTMLElement | null {
  const el = elementOf(node);
  if (!el) return null;
  if (el instanceof HTMLTextAreaElement) return el;
  if (el instanceof HTMLInputElement) return TEXT_INPUT_TYPES.has(el.type) ? el : null;
  const pm = el.closest<HTMLElement>(".ProseMirror");
  return pm && pm.isContentEditable ? pm : null;
}

function sourceOf(target: EventTarget | null): Source | null {
  const field = fieldOf(target);
  if (!field) return null;
  if (field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement) {
    const start = field.selectionStart ?? 0;
    const end = field.selectionEnd ?? 0;
    if (start === end) return null;
    return { kind: "field", el: field, start, end, value: field.value, dropped: false, copy: false };
  }
  const editor = editors.get(field);
  if (!editor) return null;
  const { from, to } = editor.state.selection;
  if (from === to) return null;
  return { kind: "editor", editor, from, to, docJson: JSON.stringify(editor.state.doc.toJSON()), slice: editor.state.doc.slice(from, to), dropped: false, copy: false };
}

function sameField(source: Source, target: EventTarget | null): boolean {
  const field = fieldOf(target);
  if (!field) return true;
  return source.kind === "field" ? field === source.el : field === source.editor.view.dom;
}

/** Borra del origen el texto arrastrado, avisando a React (input) o con una transacción (TipTap). */
function removeFromSource(source: Source): boolean {
  if (source.kind === "editor") {
    const { editor, from, to } = source;
    if (editor.isDestroyed || JSON.stringify(editor.state.doc.toJSON()) !== source.docJson) return false;
    return editor.chain().deleteRange({ from, to }).run();
  }
  const { el, start, end } = source;
  if (!el.isConnected || el.value !== source.value) return false;
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value")?.set?.call(el, source.value.slice(0, start) + source.value.slice(end));
  el.setSelectionRange(start, start);
  el.dispatchEvent(new Event("input", { bubbles: true }));
  return true;
}

/** Si el navegador borró el texto copiado del editor de origen, lo vuelve a poner donde estaba. */
function restoreEditorSource(source: Extract<Source, { kind: "editor" }>): void {
  const { editor, from, slice } = source;
  if (editor.isDestroyed || JSON.stringify(editor.state.doc.toJSON()) === source.docJson) return;
  editor.view.dispatch(editor.state.tr.replaceRange(from, from, slice));
}

let installed = false;

/** Instala (una sola vez) los oyentes globales. */
export function installDragMove(): void {
  if (installed || typeof document === "undefined") return;
  installed = true;
  let source: Source | null = null;

  document.addEventListener("dragstart", (e) => {
    source = sourceOf(e.target);
  }, true);

  // Mover por defecto y copiar con Ctrl (en Mac también Alt). Hay que fijarlo en dragover: con el editor TipTap de origen
  // Chromium deja el efecto en «mover» aunque se pulse Ctrl y borraría el origen.
  document.addEventListener("dragover", (e) => {
    if (!source || !e.dataTransfer || !fieldOf(e.target) || sameField(source, e.target)) return;
    try {
      e.dataTransfer.dropEffect = e.ctrlKey || (isMac() && e.altKey) ? "copy" : "move";
    } catch { /* efecto no permitido por el origen: se deja el del navegador */ }
  }, true);

  document.addEventListener("drop", (e) => {
    if (!source) return;
    const field = fieldOf(e.target);
    // Soltar fuera de un campo nuestro, en el mismo campo o con ficheros: sin cambios.
    if (!field || sameField(source, e.target) || e.dataTransfer?.files?.length) return;
    source.dropped = true;
    source.copy = e.ctrlKey || (isMac() && e.altKey);
  }, true);

  document.addEventListener("dragend", () => {
    const done = source;
    source = null;
    if (!done || !done.dropped) return;
    // Copiar: con el editor de origen y otro editor de destino Chromium borra igualmente el origen; se repone.
    if (done.copy) {
      if (done.kind === "editor") setTimeout(() => restoreEditorSource(done), 50);
      return;
    }
    // El navegador borra el origen al terminar el arrastre (entre inputs); si tras ello sigue igual, lo hacemos nosotros.
    setTimeout(() => removeFromSource(done), 50);
  }, true);
}
