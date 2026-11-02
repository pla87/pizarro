"use client";

import type { Editor } from "@tiptap/core";
import { Mic } from "lucide-react";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useIntlLocale, useT } from "@/i18n/client";
import { dictationChunk, dictationLang, insertDictation } from "@/lib/dictation";
import { cn } from "./cn";
import { useDictationEnabled, useDictationLangPref } from "./dictation-prefs";
import { useToast } from "./Toast";
import { applyTextareaEdit } from "./textarea-edit";

// La API de voz del navegador (Chrome, Edge, Safari, Chrome de Android) no está en los tipos de TypeScript.
interface SpeechAlternative { transcript: string }
interface SpeechResult { isFinal: boolean; length: number; [i: number]: SpeechAlternative }
interface SpeechResultEvent { resultIndex: number; results: { length: number; [i: number]: SpeechResult } }
interface Recognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((e: SpeechResultEvent) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
type RecognitionCtor = new () => Recognition;

function recognitionCtor(): RecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}
const noopSubscribe = () => () => {};

/** Chrome de Android (y navegadores basados en él): su modo continuo duplica el texto reconocido. */
function isAndroid(): boolean {
  return typeof navigator !== "undefined" && /Android/i.test(navigator.userAgent);
}

/** ¿El navegador sabe reconocer voz? En el servidor y en la primera pintura es «no» (así no hay desajuste de hidratación). */
export function useDictationSupported(): boolean {
  return useSyncExternalStore(noopSubscribe, () => recognitionCtor() !== null, () => false);
}

/**
 * Dictado por voz con la API del navegador (gratis): reconocimiento continuo con resultados provisionales. `onText` recibe
 * cada frase ya reconocida. Esc (o llamar a `stop`) lo para; se para también al desmontarse el componente.
 */
export function useDictation(onText: (text: string) => void) {
  const t = useT();
  const toast = useToast();
  const intl = useIntlLocale();
  const pref = useDictationLangPref();
  const lang = pref === "auto" ? dictationLang(intl) : pref;
  const supported = useDictationSupported();
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState("");
  const rec = useRef<Recognition | null>(null);
  // Siempre la última versión de los callbacks, sin reiniciar el reconocimiento.
  const latest = useRef({ onText, toast, t });
  useEffect(() => {
    latest.current = { onText, toast, t };
  });

  // Chrome de Android, en modo continuo, repite cada frase acumulada («esto», «esto es», «esto es una»…) como resultados
  // finales distintos. Allí se reconoce frase a frase (no continuo) y se vuelve a escuchar al terminar cada una, hasta
  // que la persona lo para.
  const wanted = useRef(false);

  const stop = useCallback(() => {
    wanted.current = false;
    rec.current?.stop();
  }, []);

  const start = useCallback(() => {
    const Ctor = recognitionCtor();
    if (!Ctor || rec.current) return;
    const phraseMode = isAndroid();
    const begin = (first: boolean) => {
      const r = new Ctor();
      r.lang = lang;
      r.continuous = !phraseMode;
      r.interimResults = true;
      let silent = false;
      r.onresult = (e) => {
        let provisional = "";
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const res = e.results[i]!;
          const text = res[0]?.transcript ?? "";
          if (res.isFinal) latest.current.onText(text);
          else provisional += text;
        }
        setInterim(provisional);
      };
      r.onerror = (e) => {
        const { toast: show, t: tr } = latest.current;
        // Silencio tras una frase al volver a escuchar: se para sin avisar (ya se dictó algo).
        if (e.error === "no-speech" && !first) {
          silent = true;
          return;
        }
        if (e.error !== "aborted") wanted.current = false;
        if (e.error === "not-allowed" || e.error === "service-not-allowed") show(tr("Permite el micrófono en el navegador"), "error");
        else if (e.error === "no-speech") show(tr("No se oyó nada. Pulsa Dictar para intentarlo de nuevo"), "error");
        else if (e.error === "audio-capture") show(tr("No se encontró ningún micrófono"), "error");
        else if (e.error === "network") show(tr("No se pudo conectar con el servicio de dictado"), "error");
        else if (e.error !== "aborted") show(tr("No se pudo dictar ({error})", { error: e.error }), "error");
      };
      r.onend = () => {
        rec.current = null;
        setInterim("");
        if (phraseMode && wanted.current && !silent && begin(false)) return;
        wanted.current = false;
        setListening(false);
      };
      rec.current = r;
      try {
        r.start();
        return true;
      } catch {
        rec.current = null;
        return false;
      }
    };
    wanted.current = true;
    if (begin(true)) setListening(true);
    else wanted.current = false;
  }, [lang]);

  // Esc para el dictado (y no llega al diálogo, que no debe cerrarse por ello).
  useEffect(() => {
    if (!listening) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopImmediatePropagation();
      stop();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [listening, stop]);

  // Al desmontarse (se cierra el diálogo) se corta el micrófono sin esperar.
  useEffect(
    () => () => {
      const r = rec.current;
      if (!r) return;
      wanted.current = false;
      r.onresult = r.onerror = r.onend = null;
      r.abort();
      rec.current = null;
    },
    [],
  );

  return { supported, listening, interim, toggle: () => (rec.current || wanted.current ? stop() : start()) };
}

/**
 * Botón de micrófono: pulsa para dictar y vuelve a pulsar (o Esc) para parar. Se oculta si el navegador no reconoce voz
 * (Firefox) o si la persona lo desactivó en Mi perfil → Preferencias. `onText` inserta cada frase donde corresponda
 * (`insertIntoField` / `insertIntoEditor`).
 */
export function DictationButton({ onText, variant = "field", placement = "beside", tabIndex, className }: {
  onText: (text: string) => void;
  /** «toolbar»: icono de la barra de formato; «field»: botón junto a un campo, con el texto «Escuchando…» mientras graba. */
  variant?: "toolbar" | "field";
  /** «inside» (solo «field»): el botón va dentro de la caja del campo, a la derecha (el contenedor debe ser `relative` y el campo llevar `pr-9`); «Escuchando…» sale debajo. */
  placement?: "beside" | "inside";
  tabIndex?: number;
  className?: string;
}) {
  const t = useT();
  const enabled = useDictationEnabled();
  const { supported, listening, interim, toggle } = useDictation(onText);
  if (!supported || !enabled) return null;
  const inside = variant === "field" && placement === "inside";
  const title = listening ? t("Parar dictado (Esc)") : t("Dictar");
  return (
    <span className={cn(inside ? "absolute right-0 z-10" : "inline-flex shrink-0 items-center gap-1.5", inside && !className && "top-0", className)}>
      <button
        type="button"
        data-dictation
        aria-label={t("Dictar")}
        aria-pressed={listening}
        title={title}
        tabIndex={tabIndex}
        // Con el ratón, el campo no pierde el foco ni el cursor.
        onMouseDown={(e) => e.preventDefault()}
        onClick={toggle}
        className={cn(
          "btn-icon relative shrink-0",
          variant === "toolbar" ? "h-7 w-7" : "h-8 w-8",
          listening && "bg-red-50 text-red-600 dark:bg-red-500/20 dark:text-red-300",
        )}
      >
        {listening && <span className="absolute inset-1 animate-ping rounded-full bg-red-500/30 motion-reduce:animate-none" aria-hidden />}
        <Mic size={15} className="relative" />
      </button>
      {listening && variant === "field" && (
        <span
          className={cn(
            "max-w-40 truncate text-xs font-medium text-red-600 dark:text-red-300",
            inside && "absolute top-full right-0 mt-0.5 max-w-[min(18rem,80vw)] rounded-md border border-slate-200 bg-white px-2 py-0.5 whitespace-nowrap shadow-sm dark:border-slate-700 dark:bg-slate-900",
          )}
          role="status"
        >
          <span className="animate-pulse motion-reduce:animate-none">{t("Escuchando…")}</span>
          {interim && <span className="ml-1 font-normal text-slate-500 max-sm:hidden">{interim}</span>}
        </span>
      )}
      {listening && variant === "toolbar" && <span className="sr-only" role="status">{t("Escuchando…")}</span>}
    </span>
  );
}

/** Inserta la frase dictada en el cursor (o sobre la selección) de un input o textarea, conservando el deshacer del navegador. */
export function insertIntoField(el: HTMLInputElement | HTMLTextAreaElement | null, spoken: string, onValueChange: (v: string) => void, newLine = false) {
  if (!el) return;
  const start = el.selectionStart ?? el.value.length;
  const end = el.selectionEnd ?? el.value.length;
  let edit = insertDictation(el.value, start, end, spoken, newLine);
  // maxLength: el dictado no lo salta (un cambio programático no lo comprueba el navegador). Se recorta lo dictado hasta que quepa.
  const max = el.maxLength;
  if (max >= 0) {
    let s = spoken;
    while (edit && edit.value.length > max && s.trim()) {
      s = s.slice(0, Math.max(0, s.length - (edit.value.length - max))).trimEnd();
      edit = insertDictation(el.value, start, end, s, newLine);
    }
    if (edit && edit.value.length > max) edit = null;
  }
  if (edit) applyTextareaEdit(el, edit, onValueChange);
}

/** Inserta la frase dictada en la selección del editor con barra (TipTap). */
export function insertIntoEditor(editor: Editor | null, spoken: string) {
  if (!editor) return;
  const { from, to } = editor.state.selection;
  const doc = editor.state.doc;
  const before = doc.textBetween(Math.max(0, from - 200), from, "\n", "\n");
  const after = doc.textBetween(to, Math.min(doc.content.size, to + 1), "\n", "\n");
  const chunk = dictationChunk(before, after, spoken);
  // Como nodo de texto (no como HTML), para que los espacios de los extremos se conserven.
  if (chunk) editor.chain().insertContent({ type: "text", text: chunk }).run();
}
