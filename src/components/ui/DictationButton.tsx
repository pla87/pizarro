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

  const stop = useCallback(() => rec.current?.stop(), []);

  const start = useCallback(() => {
    const Ctor = recognitionCtor();
    if (!Ctor || rec.current) return;
    const r = new Ctor();
    r.lang = lang;
    r.continuous = true;
    r.interimResults = true;
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
      if (e.error === "not-allowed" || e.error === "service-not-allowed") show(tr("Permite el micrófono en el navegador"), "error");
      else if (e.error === "no-speech") show(tr("No se oyó nada. Pulsa Dictar para intentarlo de nuevo"), "error");
      else if (e.error === "audio-capture") show(tr("No se encontró ningún micrófono"), "error");
      else if (e.error === "network") show(tr("No se pudo conectar con el servicio de dictado"), "error");
      else if (e.error !== "aborted") show(tr("No se pudo dictar ({error})", { error: e.error }), "error");
    };
    r.onend = () => {
      rec.current = null;
      setListening(false);
      setInterim("");
    };
    rec.current = r;
    try {
      r.start();
      setListening(true);
    } catch {
      rec.current = null;
    }
  }, [lang]);

  // Esc para el dictado (y no llega al diálogo, que no debe cerrarse por ello).
  useEffect(() => {
    if (!listening) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopImmediatePropagation();
      rec.current?.stop();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [listening]);

  // Al desmontarse (se cierra el diálogo) se corta el micrófono sin esperar.
  useEffect(
    () => () => {
      const r = rec.current;
      if (!r) return;
      r.onresult = r.onerror = r.onend = null;
      r.abort();
      rec.current = null;
    },
    [],
  );

  return { supported, listening, interim, toggle: () => (rec.current ? stop() : start()) };
}

/**
 * Botón de micrófono: pulsa para dictar y vuelve a pulsar (o Esc) para parar. Se oculta si el navegador no reconoce voz
 * (Firefox) o si la persona lo desactivó en Mi perfil → Preferencias. `onText` inserta cada frase donde corresponda
 * (`insertIntoField` / `insertIntoEditor`).
 */
export function DictationButton({ onText, variant = "field", tabIndex, className }: {
  onText: (text: string) => void;
  /** «toolbar»: icono de la barra de formato; «field»: botón junto a un campo, con el texto «Escuchando…» mientras graba. */
  variant?: "toolbar" | "field";
  tabIndex?: number;
  className?: string;
}) {
  const t = useT();
  const enabled = useDictationEnabled();
  const { supported, listening, interim, toggle } = useDictation(onText);
  if (!supported || !enabled) return null;
  const title = listening ? t("Parar dictado (Esc)") : t("Dictar");
  return (
    <span className={cn("inline-flex shrink-0 items-center gap-1.5", className)}>
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
        <span className="max-w-40 truncate text-xs font-medium text-red-600 dark:text-red-300" role="status">
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
  const edit = insertDictation(el.value, el.selectionStart ?? el.value.length, el.selectionEnd ?? el.value.length, spoken, newLine);
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
