"use client";

import { Check, Copy, Eraser } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useT } from "@/i18n/client";
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
 */
export function DescriptionTools({ value, onClear, className }: { value: string; onClear: () => void; className?: string }) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const has = value.trim().length > 0;
  return (
    <span className={cn("flex items-center gap-0.5", className)}>
      <span role="status" aria-live="polite" className="text-xs text-slate-400">{copied ? t("Copiado") : ""}</span>
      {has && (
        <>
          <button
            type="button"
            tabIndex={-1}
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
          <button type="button" tabIndex={-1} className={BTN} title={t("Borrar descripción")} aria-label={t("Borrar descripción")} data-testid="desc-clear" onMouseDown={(e) => e.preventDefault()} onClick={onClear}>
            <Eraser size={14} />
          </button>
        </>
      )}
    </span>
  );
}
