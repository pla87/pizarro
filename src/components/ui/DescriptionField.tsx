"use client";

import { Bold, Code, Code2, Heading2, Heading3, IndentDecrease, IndentIncrease, Italic, Link2, List, ListOrdered, Minus, Quote, Strikethrough, Underline } from "lucide-react";
import type { Editor } from "@tiptap/core";
import { useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useT } from "@/i18n/client";
import { refreshWhenOnline } from "@/lib/connection";
import { indentLines, insertLink, insertRule, toggleCodeBlock, toggleLinePrefix, toggleWrap, type EditResult } from "@/lib/markdown-edit";
import { cn } from "./cn";
import { DictationButton, insertIntoField } from "./DictationButton";
import { FormatToolbar, FORMAT_BAR_CLASS, FORMAT_BOX_CLASS, type FormatItems } from "./FormatToolbar";
import { MentionTextarea, type MentionCommand } from "./MentionTextarea";
import { applyTextareaEdit } from "./textarea-edit";
import { tablesOnlyMarkdown } from "@/lib/paste-table";
import type { EditAnchor } from "@/lib/edit-anchor";
import { anchorFromTextarea, placeEditorAt, placeTextareaAt } from "./editAnchorDom";
import { attachablePasteFiles, claimDrop, claimPaste, pasteClaimed, recoverEmptyImages } from "./pasteFiles";
import { isUntypedImage } from "@/lib/document-kind";
import { useToast } from "./Toast";

import type { EditorModeValue, UserOption } from "@/lib/types";

// El editor con barra (TipTap) pesa: solo se descarga para quien lo usa (el tablero lo precarga en reposo).
type RichEditor = typeof import("./RichTextEditor").RichTextEditor;
let richEditor: RichEditor | null = null;
// Viene con el editor (no se importa aquí: arrastraría ProseMirror al trozo que se carga siempre).
let insertImageBlocks: typeof import("./RichTextEditor").insertImageBlocks | null = null;
let richEditorLoad: Promise<RichEditor> | null = null;
function loadRichEditor(): Promise<RichEditor> {
  richEditorLoad ??= import("./RichTextEditor").then(
    (m) => {
      insertImageBlocks = m.insertImageBlocks;
      return (richEditor = m.RichTextEditor);
    },
    (e: unknown) => {
      richEditorLoad = null; // sin red: se reintenta la próxima vez
      throw e;
    },
  );
  return richEditorLoad;
}

const MARKDOWN_HINT = "**negrita**, *cursiva*, ~~tachado~~, ++subrayado++, # Título, - lista, 1. lista";

interface Props {
  id?: string;
  mode: EditorModeValue;
  value: string;
  onValueChange: (v: string) => void;
  users: UserOption[];
  placeholder?: string;
  autoFocus?: boolean;
  onCommand?: (kind: MentionCommand) => void;
  onSubmit?: () => void;
  onCancel?: () => void;
  textareaRef?: React.Ref<HTMLTextAreaElement>;
  textareaClassName?: string;
  /**
   * Punto del doble clic en la vista de lectura: al montar, el cursor va ahí y el texto bajo el ratón se queda en su sitio
   * (en vez del foco al final, que desplazaba el panel hasta el final de una descripción larga). Sustituye a `autoFocus`.
   */
  startAt?: EditAnchor | null;
  /**
   * Imágenes pegadas (Ctrl+V de una captura) o soltadas en el campo: las sube (como adjuntos de la tarea) y devuelve las
   * subidas, que se insertan donde está el cursor (`![nombre](/api/attachments/<id>)`). Sin él, el pegado y el soltado
   * siguen su curso (el diálogo los adjunta). Lo pegado o soltado sin imágenes también.
   */
  onFiles?: (files: File[]) => Promise<InlineImage[]>;
  /**
   * Imágenes pegadas o soltadas que aún se están subiendo (0 al acabar, ya insertadas): quien pinta los botones del
   * editor dice «Subiendo imagen…» y puede esperar a que acaben para guardar.
   */
  onUploadsChange?: (pending: number) => void;
}

/** Imagen subida que se inserta en el texto. */
interface InlineImage {
  id: string;
  name: string;
  /** Dirección de la imagen; sin ella, la del adjunto (`/api/attachments/<id>`). Las notas de Documentación: `/api/documents/<id>`. */
  src?: string;
}

const imageSrc = (img: InlineImage) => img.src ?? `/api/attachments/${img.id}`;

const isImage = (f: File) => f.type.startsWith("image/") || isUntypedImage(f.name, f.type);

/** Markdown de una imagen subida (el texto alternativo, con los corchetes escapados como los guarda el editor con barra). */
function imageMarkdown(img: InlineImage): string {
  return `![${img.name.replace(/[[\]\\]/g, "\\$&")}](${imageSrc(img)})`;
}

/**
 * Campo de descripción: textarea con Markdown (con barra de formato) o editor con barra, según el perfil.
 *
 * Teclado en el modo Markdown: Tab sangra y Mayús+Tab desangra las líneas de lista bajo el cursor o la selección, y solo
 * cuando se puede (no en el primer elemento, ni si ya cuelga del anterior, ni fuera de una lista). En cualquier otro caso Tab
 * conserva su función de mover el foco, así que el teclado nunca queda atrapado. Los botones de la barra están fuera del orden
 * de Tab; se entra con Alt+F10 (flechas para moverse; Tab o Escape vuelven al texto).
 */
export function DescriptionField({ id, mode, value, onValueChange, users, placeholder, autoFocus, onCommand, onSubmit, onCancel, textareaRef, textareaClassName, startAt, onFiles, onUploadsChange }: Props) {
  const t = useT();
  const toast = useToast();
  const inner = useRef<HTMLTextAreaElement | null>(null);
  const root = useRef<HTMLDivElement>(null);
  useImperativeHandle(textareaRef, () => inner.current!);
  // El editor con barra, cuando ya existe (para insertar las imágenes subidas en su cursor).
  const editorOutRef = useRef<Editor | null>(null);
  const changeRef = useRef(onValueChange);
  const uploadsRef = useRef(onUploadsChange);
  useEffect(() => {
    changeRef.current = onValueChange;
    uploadsRef.current = onUploadsChange;
  });
  // ¿Sigue montado el campo? Una subida que acaba con el editor ya cerrado (Cancelar, cerrar el detalle, «Deshacer todo»)
  // no avisa a quien lo pintaba: su `onUploadsChange` es el del último dibujo con el editor abierto y, si se había pedido
  // guardar, guardaba (o cerraba el editor abierto después) aunque se hubiera descartado lo escrito.
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  // Imágenes subiéndose desde este campo (las que se insertarán al llegar).
  const pendingImages = useRef(0);
  /**
   * Inserta las imágenes subidas donde está el cursor ahora (la subida tarda: se puede haber seguido escribiendo). En el
   * editor con barra, cada una en su bloque (insertImageBlocks); en el campo de texto, separadas por espacios de lo que haya alrededor; sin quitarle el foco a otro sitio si ya no lo tiene.
   * Si el editor ya se ha cerrado (Cancelar, Escape), se avisa: la imagen es un adjunto de la tarea, pero no está en el
   * texto (antes no se decía nada y parecía que el pegado no había funcionado).
   */
  const insertImages = (images: InlineImage[]) => {
    if (!images.length) return;
    const ed = editorOutRef.current;
    const toBlocks = insertImageBlocks;
    if (mode === "WYSIWYG" && ed && !ed.isDestroyed && toBlocks) {
      // Cada imagen, en su propio bloque (no en línea dentro del párrafo): el cursor queda en un párrafo nuevo debajo.
      const nodes = images.map((img) => ed.schema.nodes.markdownImage!.create({ raw: imageMarkdown(img), src: imageSrc(img), alt: img.name }));
      ed.chain().command(({ tr }) => {
        toBlocks(tr, nodes);
        return true;
      }).run();
      return;
    }
    const el = inner.current;
    if (!el?.isConnected) {
      toast(
        images.length === 1
          ? t("La imagen se ha adjuntado, pero el editor ya estaba cerrado: no está en la descripción")
          : t("Las imágenes se han adjuntado, pero el editor ya estaba cerrado: no están en la descripción"),
        "error",
      );
      return;
    }
    const md = images.map(imageMarkdown).join(" ");
    const start = el.selectionStart, end = el.selectionEnd;
    const before = el.value.slice(0, start), after = el.value.slice(end);
    const lead = before && !/\s$/.test(before) ? " " : "";
    const trail = after && !/^\s/.test(after) ? " " : "";
    const next = before + lead + md + trail + after;
    const caret = before.length + lead.length + md.length + trail.length;
    if (document.activeElement === el) applyTextareaEdit(el, { value: next, start: caret, end: caret }, changeRef.current);
    else changeRef.current(next);
  };
  const upload = (files: File[]) => {
    if (!onFiles) return;
    const count = files.filter(isImage).length;
    pendingImages.current += count;
    uploadsRef.current?.(pendingImages.current);
    void onFiles(files)
      .then(insertImages, () => undefined)
      .finally(() => {
        pendingImages.current -= count;
        if (alive.current) uploadsRef.current?.(pendingImages.current);
      });
  };
  /**
   * ¿El pegado o el soltado va al texto de este campo? Solo si su destino es la caja de texto (el editor con barra o el
   * área de texto) y, al pegar, si el foco está en ella. Lo demás (otro campo, un botón, fuera de las cajas) sigue su
   * curso: el diálogo lo adjunta sin insertarlo (antes, con la descripción abierta, también entraba en el texto).
   */
  const ownsEvent = (container: Element, target: EventTarget | null, paste: boolean): boolean => {
    const el = target instanceof Element ? target : target instanceof Node ? target.parentElement : null;
    const box = el?.closest<HTMLElement>("textarea, [contenteditable=true], [contenteditable='']");
    if (!box || !container.contains(box)) return false;
    return !paste || box.contains(document.activeElement);
  };
  // En captura: antes que el editor (que deja los archivos sin pegar) y que el diálogo (que solo los adjunta).
  const fileHandlers = onFiles
    ? {
        onPasteCapture: (e: React.ClipboardEvent) => {
          const native = e.nativeEvent as ClipboardEvent;
          if (pasteClaimed(native) || !ownsEvent(e.currentTarget, native.target, true)) return;
          const files = attachablePasteFiles(native);
          if (!files.some(isImage)) return;
          claimPaste(native);
          // Una captura que llega vacía (Windows) se pide otra vez al portapapeles, como al adjuntar.
          void recoverEmptyImages(files).then(upload);
        },
        onDropCapture: (e: React.DragEvent) => {
          if (!ownsEvent(e.currentTarget, e.nativeEvent.target, false)) return;
          const files = Array.from(e.dataTransfer?.files ?? []);
          if (!files.some(isImage)) return;
          claimDrop(e.nativeEvent);
          // En el editor con barra, el cursor va al punto donde se suelta (en el campo de texto se queda donde estaba).
          const ed = editorOutRef.current;
          const at = mode === "WYSIWYG" && ed && !ed.isDestroyed ? ed.view.posAtCoords({ left: e.clientX, top: e.clientY }) : null;
          if (ed && at) ed.chain().focus().setTextSelection(at.pos).run();
          upload(files);
        },
      }
    : {};
  const run = useCallback(
    (edit: (value: string, start: number, end: number) => EditResult | null) => {
      const el = inner.current;
      if (!el) return;
      const result = edit(el.value, el.selectionStart, el.selectionEnd);
      if (result) applyTextareaEdit(el, result, onValueChange);
      el.focus();
    },
    [onValueChange],
  );
  const items = useMemo<FormatItems>(
    () => [
      { title: "Negrita (Ctrl+B)", icon: Bold, run: () => run((v, s, e) => toggleWrap(v, s, e, "**", "**", "negrita")) },
      { title: "Cursiva (Ctrl+I)", icon: Italic, run: () => run((v, s, e) => toggleWrap(v, s, e, "*", "*", "cursiva")) },
      { title: "Subrayado (Ctrl+U)", icon: Underline, run: () => run((v, s, e) => toggleWrap(v, s, e, "++", "++", "subrayado")) },
      { title: "Tachado", icon: Strikethrough, run: () => run((v, s, e) => toggleWrap(v, s, e, "~~", "~~", "tachado")) },
      null,
      { title: "Título", icon: Heading2, run: () => run((v, s, e) => toggleLinePrefix(v, s, e, "h2")) },
      { title: "Subtítulo", icon: Heading3, run: () => run((v, s, e) => toggleLinePrefix(v, s, e, "h3")) },
      null,
      { title: "Lista", icon: List, run: () => run((v, s, e) => toggleLinePrefix(v, s, e, "ul")) },
      { title: "Lista numerada", icon: ListOrdered, run: () => run((v, s, e) => toggleLinePrefix(v, s, e, "ol")) },
      { title: "Aumentar sangría (Tab)", icon: IndentIncrease, run: () => run((v, s, e) => indentLines(v, s, e, 1)) },
      { title: "Reducir sangría (Mayús+Tab)", icon: IndentDecrease, run: () => run((v, s, e) => indentLines(v, s, e, -1)) },
      null,
      { title: "Cita", icon: Quote, run: () => run((v, s, e) => toggleLinePrefix(v, s, e, "quote")) },
      { title: "Código", icon: Code, run: () => run((v, s, e) => toggleWrap(v, s, e, "`", "`", "código")) },
      { title: "Bloque de código", icon: Code2, run: () => run(toggleCodeBlock) },
      { title: "Línea horizontal", icon: Minus, run: () => run(insertRule) },
      { title: "Enlace (Ctrl+K)", icon: Link2, run: () => run(insertLink) },
    ],
    [run],
  );

  // Modo Markdown: el cursor en el punto del doble clic, sin desplazar (con `autoFocus` iba al principio y el navegador
  // llevaba el panel hasta él).
  useLayoutEffect(() => {
    if (mode !== "WYSIWYG" && startAt && inner.current) placeTextareaAt(inner.current, startAt);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- solo al montar
  }, []);

  if (mode === "WYSIWYG") {
    const field = <WysiwygField fieldRef={inner} editorOutRef={editorOutRef} id={id} value={value} onValueChange={onValueChange} onSubmit={onSubmit} onCancel={onCancel} placeholder={placeholder} autoFocus={autoFocus} startAt={startAt} users={users} onCommand={onCommand} />;
    return onFiles ? <div {...fileHandlers}>{field}</div> : field;
  }
  return (
    <>
    <div
      ref={root}
      {...fileHandlers}
      className={cn(FORMAT_BOX_CLASS, "[&_textarea:focus]:border-transparent [&_textarea:focus]:ring-0 [&_textarea]:rounded-t-none [&_textarea]:border-0 [&_textarea]:bg-transparent")}
    >
      <FormatToolbar
        items={items}
        onLeave={() => inner.current?.focus()}
        className={FORMAT_BAR_CLASS}
        trailing={<DictationButton variant="toolbar" tabIndex={-1} within={() => root.current} onText={(s) => insertIntoField(inner.current, s, onValueChange)} />}
      />
      <MentionTextarea
        ref={inner}
        id={id}
        className={textareaClassName ?? "input field-sizing-content min-h-32 font-mono text-[13px]"}
        value={value}
        onValueChange={onValueChange}
        users={users}
        onCommand={onCommand}
        placeholder={placeholder}
        autoFocus={autoFocus && !startAt}
        onPaste={(e) => {
          // Una tabla copiada de Excel, Google Sheets, Word o una web entra como tabla Markdown (no como texto con tabuladores).
          const md = tablesOnlyMarkdown(e.clipboardData.getData("text/html"));
          if (!md) return;
          e.preventDefault();
          const el = e.currentTarget;
          const start = el.selectionStart, end = el.selectionEnd;
          // La tabla necesita una línea en blanco antes y después para leerse como tabla.
          const before = el.value.slice(0, start), after = el.value.slice(end);
          const lead = !before || before.endsWith("\n\n") ? "" : before.endsWith("\n") ? "\n" : "\n\n";
          const trail = !after || after.startsWith("\n\n") ? "" : after.startsWith("\n") ? "\n" : "\n\n";
          const insert = lead + md + trail;
          const caret = start + lead.length + md.length;
          applyTextareaEdit(el, { value: before + insert + after, start: caret, end: caret }, onValueChange);
        }}
        onKeyDown={(e) => {
          if (e.nativeEvent.isComposing) return;
          // Alt+F10: lleva el foco a la barra de formato (sus botones se saltan con Tab).
          if (e.key === "F10" && e.altKey) {
            e.preventDefault();
            root.current?.querySelector<HTMLElement>("[role=toolbar] button")?.focus();
            return;
          }
          const mod = (e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey;
          const key = e.key.toLowerCase();
          if (mod && (key === "b" || key === "i" || key === "u" || key === "k")) {
            e.preventDefault();
            const mark = ({ b: "**", i: "*", u: "++" } as Record<string, string>)[key];
            run(mark ? (v, s, en) => toggleWrap(v, s, en, mark, mark) : insertLink);
            return;
          }
          // Tab / Mayús+Tab: solo sangran si hay algo que sangrar; si no, siguen su camino (mover el foco).
          if (e.key === "Tab" && !e.metaKey && !e.ctrlKey && !e.altKey) {
            const el = e.currentTarget;
            const result = indentLines(el.value, el.selectionStart, el.selectionEnd, e.shiftKey ? -1 : 1);
            if (result) {
              e.preventDefault();
              applyTextareaEdit(el, result, onValueChange);
            }
            return;
          }
          if (e.key === "Escape" && onCancel) {
            e.preventDefault();
            onCancel();
          }
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && onSubmit) {
            e.preventDefault();
            onSubmit();
          }
        }}
      />
    </div>
    <p className="mt-1 text-xs text-slate-500">{t(MARKDOWN_HINT)}</p>
    </>
  );
}

/**
 * Editor con barra. Si aún no se ha descargado (red lenta), mientras tanto se escribe en un campo de texto provisional:
 * antes solo se veía un hueco gris y las primeras teclas se perdían («Hola equipo» quedaba en «equipo»). Cuando el editor
 * está listo (montado oculto con lo escrito) ocupa su sitio en la misma pasada, con el texto y el foco al final.
 */
function WysiwygField({ fieldRef, editorOutRef, id, value, onValueChange, users, placeholder, autoFocus, startAt, onCommand, onSubmit, onCancel }: Omit<Props, "mode" | "textareaRef" | "textareaClassName" | "onFiles"> & {
  fieldRef: React.MutableRefObject<HTMLTextAreaElement | null>;
  editorOutRef: React.MutableRefObject<Editor | null>;
}) {
  const [Loaded, setLoaded] = useState<RichEditor | null>(() => richEditor);
  const [provisional, setProvisional] = useState(() => !richEditor);
  // Si empezó con el campo provisional, la estructura no cambia al quitarlo: el editor ya montado (oculto) es el mismo
  // que luego se ve (en otro sitio del árbol, React lo volvería a crear y habría un instante sin campo).
  const [startedProvisional] = useState(provisional);
  const focusOnSwap = useRef<Editor | null>(null);
  // Sin red el editor no llega: el campo provisional sigue sirviendo (Markdown) y se vuelve a pedir al volver la red.
  const [loadTry, setLoadTry] = useState(0);
  useEffect(() => {
    if (Loaded) return;
    let alive = true;
    loadRichEditor().then(
      (E) => alive && setLoaded(() => E),
      () => alive && refreshWhenOnline(() => alive && setLoadTry((n) => n + 1)),
    );
    return () => {
      alive = false;
    };
  }, [Loaded, loadTry]);
  // Al montar con foco, el cursor va al final del texto (como en el editor).
  useLayoutEffect(() => {
    const el = fieldRef.current;
    if (!provisional || !autoFocus || !el) return;
    // Abierto con doble clic: en el punto del clic, sin desplazar (ver startAt).
    if (startAt) return placeTextareaAt(el, startAt);
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- solo al montar
  }, []);
  // Punto del cursor en el campo provisional al cambiarlo por el editor (si se abrió con doble clic): el editor sigue ahí.
  const swapAnchor = useRef<EditAnchor | null>(null);
  useLayoutEffect(() => {
    const ed = focusOnSwap.current;
    if (provisional || !ed) return;
    focusOnSwap.current = null;
    if (swapAnchor.current) return placeEditorAt(ed, swapAnchor.current);
    // focus("end") pone el cursor al final, pero el foco lo da en el siguiente fotograma: sin view.focus() la tecla
    // pulsada en ese instante (ya sin el campo provisional) se perdía.
    ed.commands.focus("end");
    ed.view.focus();
  }, [provisional]);
  const onReady = (ed: Editor) => {
    editorOutRef.current = ed;
    if (!provisional) {
      // Abierto con doble clic: el cursor al punto del clic cuando el editor ya está en la página (siguiente fotograma).
      if (startAt && autoFocus) requestAnimationFrame(() => !ed.isDestroyed && placeEditorAt(ed, startAt));
      return;
    }
    // Si se estaba escribiendo en el campo provisional, el foco pasa al editor (ver el efecto de arriba).
    if (typeof document !== "undefined" && document.activeElement === fieldRef.current) {
      focusOnSwap.current = ed;
      if (startAt && fieldRef.current) swapAnchor.current = anchorFromTextarea(fieldRef.current);
    }
    setProvisional(false);
  };
  // `autoFocus` del editor solo si nace visible y sin punto de doble clic: TipTap aplica su `autofocus` en un setTimeout
  // tras crearse y lee la opción en ese momento, así que si pasaba a `true` al quitar el campo provisional llevaba el
  // cursor (y el panel) al final, después de colocarlo. Al quitar el campo provisional el foco lo pone el efecto de arriba.
  const editor = Loaded && (
    <Loaded id={id} value={value} onChange={onValueChange} onSubmit={onSubmit} onCancel={onCancel} placeholder={placeholder} autoFocus={autoFocus && !startedProvisional && !startAt} users={users} onCommand={onCommand} onReady={onReady} />
  );
  if (!startedProvisional) return editor;
  return (
    <div className={provisional ? "relative" : undefined}>
      {provisional && (
        <div className={FORMAT_BOX_CLASS} data-provisional-editor>
          <div className={cn(FORMAT_BAR_CLASS, "h-9")} aria-hidden />
          <textarea
            ref={fieldRef}
            id={id}
            className="block min-h-32 w-full resize-none border-0 bg-transparent px-3 py-2 text-sm outline-none field-sizing-content focus:ring-0"
            value={value}
            onChange={(e) => onValueChange(e.target.value)}
            placeholder={placeholder}
            aria-label={placeholder}
            onKeyDown={(e) => {
              if (e.nativeEvent.isComposing) return;
              if (e.key === "Escape" && onCancel) {
                e.preventDefault();
                onCancel();
              }
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && onSubmit) {
                e.preventDefault();
                onSubmit();
              }
            }}
          />
        </div>
      )}
      {/* El editor ya descargado se monta oculto e inerte (sin foco ni clics) hasta que existe: ver onReady. */}
      {editor && (
        <div className={provisional ? "pointer-events-none absolute inset-x-0 top-0 -z-10 opacity-0" : undefined} inert={provisional}>
          {editor}
        </div>
      )}
    </div>
  );
}
