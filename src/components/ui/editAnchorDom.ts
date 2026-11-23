import type { Editor } from "@tiptap/core";
import { ANCHOR_CONTEXT, anchorIndex, type EditAnchor } from "@/lib/edit-anchor";

/** Punto del texto bajo (x, y), en el navegador que sea (Firefox: caretPositionFromPoint; Chrome y Safari: caretRangeFromPoint). */
function caretRangeAt(x: number, y: number): Range | null {
  const d = document as Document & {
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
  };
  const p = d.caretPositionFromPoint?.(x, y);
  if (p) {
    const r = document.createRange();
    r.setStart(p.offsetNode, p.offset);
    return r;
  }
  return d.caretRangeFromPoint?.(x, y) ?? null;
}

/** Ancla del doble clic en (x, y) dentro de `root` (la vista de lectura); null si no cae en su texto. */
export function anchorFromPoint(root: HTMLElement, x: number, y: number): EditAnchor | null {
  const range = caretRangeAt(x, y);
  if (!range || !root.contains(range.startContainer)) return null;
  const pre = document.createRange();
  pre.selectNodeContents(root);
  pre.setEnd(range.startContainer, range.startOffset);
  const full = root.textContent ?? "";
  const offset = pre.toString().length;
  const rect = range.getClientRects()[0];
  return {
    before: full.slice(Math.max(0, offset - ANCHOR_CONTEXT), offset),
    after: full.slice(offset, offset + ANCHOR_CONTEXT),
    ratio: full.length ? offset / full.length : 0,
    top: rect && rect.height ? rect.top : y,
  };
}

/** Desplaza el primer antepasado de `el` con scroll (o la página) para que lo que ahora está a la altura `now` pase a `wanted`. */
function scrollBy(el: HTMLElement, now: number, wanted: number) {
  const delta = now - wanted;
  if (Math.abs(delta) < 1) return;
  for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
    if (/(auto|scroll)/.test(getComputedStyle(a).overflowY) && a.scrollHeight > a.clientHeight) {
      a.scrollTop += delta;
      return;
    }
  }
  window.scrollBy(0, delta);
}

/**
 * Línea del carácter `index` de un textarea, en la ventana (arriba, abajo e izquierda): con una copia invisible que reparte
 * igual las líneas. Sirve para dejar el cursor a una altura y para poner la lista de «@» junto a él.
 */
export function textareaCaretRect(el: HTMLTextAreaElement, index: number): { top: number; bottom: number; left: number } {
  const s = getComputedStyle(el);
  const mirror = document.createElement("div");
  for (const p of ["boxSizing", "width", "paddingTop", "paddingRight", "paddingBottom", "paddingLeft", "borderTopWidth", "borderRightWidth", "borderBottomWidth", "borderLeftWidth", "fontFamily", "fontSize", "fontWeight", "fontStyle", "letterSpacing", "lineHeight", "tabSize", "textIndent", "wordSpacing"] as const) {
    mirror.style[p] = s[p];
  }
  Object.assign(mirror.style, { position: "absolute", visibility: "hidden", top: "0", left: "-9999px", whiteSpace: "pre-wrap", overflowWrap: "break-word", borderStyle: "solid" });
  mirror.textContent = el.value.slice(0, index);
  const mark = document.createElement("span");
  mark.textContent = "\u200b";
  mirror.appendChild(mark);
  document.body.appendChild(mirror);
  const { offsetTop, offsetLeft, offsetHeight } = mark;
  mirror.remove();
  const box = el.getBoundingClientRect();
  const top = box.top + offsetTop - el.scrollTop;
  return { top, bottom: top + offsetHeight, left: box.left + offsetLeft - el.scrollLeft };
}

const textareaCaretTop = (el: HTMLTextAreaElement, index: number) => textareaCaretRect(el, index).top;

/** Ancla del cursor de un textarea (el campo provisional del editor con barra, al cambiarlo por el editor). */
export function anchorFromTextarea(el: HTMLTextAreaElement): EditAnchor {
  const i = el.selectionStart;
  return {
    before: el.value.slice(Math.max(0, i - ANCHOR_CONTEXT), i),
    after: el.value.slice(i, i + ANCHOR_CONTEXT),
    ratio: el.value.length ? i / el.value.length : 0,
    top: textareaCaretTop(el, i),
  };
}

/** Cursor del textarea en el punto del ancla, con el foco y sin que se mueva el texto. */
export function placeTextareaAt(el: HTMLTextAreaElement, a: EditAnchor) {
  const i = anchorIndex(el.value, a);
  el.focus({ preventScroll: true });
  el.setSelectionRange(i, i);
  const fix = () => scrollBy(el, textareaCaretTop(el, i), a.top);
  fix();
  // Otra vez en el siguiente fotograma: lo que se ajuste al enfocar (el margen del anillo de foco) no debe moverlo.
  requestAnimationFrame(fix);
}

/** Lo mismo en el editor con barra. */
export function placeEditorAt(ed: Editor, a: EditAnchor) {
  const dom = ed.view.dom as HTMLElement;
  const index = anchorIndex(dom.textContent ?? "", a);
  let pos = ed.state.doc.content.size;
  // Del índice en el texto al nodo de texto del editor que lo contiene, y de ahí a la posición de ProseMirror.
  const walker = document.createTreeWalker(dom, NodeFilter.SHOW_TEXT);
  let seen = 0;
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const len = n.textContent?.length ?? 0;
    if (seen + len >= index) {
      try {
        pos = ed.view.posAtDOM(n, index - seen);
      } catch {
        // Un nodo que ProseMirror no reconoce (una mención): se queda al final.
      }
      break;
    }
    seen += len;
  }
  try {
    ed.chain().setTextSelection(pos).run();
  } catch {
    // Posición fuera del documento: el cursor se queda donde esté.
  }
  ed.view.focus();
  const fix = () => {
    if (ed.isDestroyed) return;
    scrollBy(dom, ed.view.coordsAtPos(ed.state.selection.from).top, a.top);
  };
  fix();
  requestAnimationFrame(fix);
}
