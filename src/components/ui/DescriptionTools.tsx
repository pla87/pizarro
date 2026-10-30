"use client";

import { Check, Copy, Eraser } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useIntlLocale, useT } from "@/i18n/client";
import type { T } from "@/i18n/core";
import { MAX_DESCRIPTION } from "@/lib/constants";
import { cn } from "./cn";
import { copyText } from "./clipboard";

/** Copia la descripción con formato (text/html) y como Markdown (text/plain); sin ClipboardItem, solo el Markdown. */
export async function copyDescription(markdown: string): Promise<boolean> {
  try {
    if (typeof ClipboardItem !== "undefined" && navigator.clipboard?.write) {
      const { markdownToHtml } = await import("@/lib/markdown-html");
      const html = markdownToHtml(markdown, location.origin);
      await navigator.clipboard.write([
        new ClipboardItem({
          "text/html": new Blob([html], { type: "text/html" }),
          "text/plain": new Blob([markdown], { type: "text/plain" }),
        }),
      ]);
      return true;
    }
  } catch {
    // Permiso denegado o formato no admitido: se copia solo el Markdown.
  }
  return copyText(markdown);
}

const BTN = "btn-icon h-6 w-6 text-slate-300 hover:text-slate-600 focus-visible:text-slate-600 dark:text-slate-600 dark:hover:text-slate-300 dark:focus-visible:text-slate-300";

/**
 * Dos iconos discretos junto a la descripción: copiar (con formato) y borrar. Solo si hay contenido.
 * Fuera del orden de Tab (Título → descripción directo); se alcanzan con el ratón o un lector de pantalla.
 * Los iconos ocupan su sitio siempre (invisibles sin contenido) para que el diálogo no cambie de tamaño al escribir.
 * Con `max`, si el texto lo supera aparece el recuento («12.345 / 20.000») en el color de marca, antes de los iconos.
 */
export function DescriptionTools({ value, onClear, className, max }: { value: string; onClear: () => void; className?: string; max?: number }) {
  const t = useT();
  const locale = useIntlLocale();
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const has = value.trim().length > 0;
  const over = max !== undefined && value.length > max;
  return (
    <span className={cn("flex items-center gap-0.5", className)}>
      {over && (
        <span role="alert" data-testid="desc-count" className="mr-1 text-xs font-semibold whitespace-nowrap text-brand-700 dark:text-brand-300" title={t("La descripción supera el límite de {max} caracteres.", { max: max!.toLocaleString(locale) })}>
          {value.length.toLocaleString(locale)} / {max!.toLocaleString(locale)}
        </span>
      )}
      <span role="status" aria-live="polite" className="text-xs text-slate-400">{copied ? t("Copiado") : ""}</span>
      <span className={cn("flex items-center gap-0.5", !has && "invisible")} aria-hidden={!has}>
          <button
            type="button"
            tabIndex={-1}
            disabled={!has}
            className={BTN}
            title={t("Copiar descripción")}
            aria-label={t("Copiar descripción")}
            data-testid="desc-copy"
            onMouseDown={(e) => e.preventDefault()}
            onClick={async () => {
              if (!(await copyDescription(value))) return;
              setCopied(true);
              clearTimeout(timer.current);
              timer.current = setTimeout(() => setCopied(false), 1500);
            }}
          >
            {copied ? <Check size={14} /> : <Copy size={14} />}
          </button>
          <button type="button" tabIndex={-1} disabled={!has} className={BTN} title={t("Borrar descripción")} aria-label={t("Borrar descripción")} data-testid="desc-clear" onMouseDown={(e) => e.preventDefault()} onClick={onClear}>
            <Eraser size={14} />
          </button>
      </span>
    </span>
  );
}

/** Mensaje de error cuando la descripción supera el límite (el servidor también lo valida). */
export function descriptionTooLong(t: T, locale: string, max: number = MAX_DESCRIPTION): string {
  return t("La descripción supera el límite de {max} caracteres.", { max: max.toLocaleString(locale) });
}
