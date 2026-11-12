"use client";

import { MAX_TITLE, MAX_TITLE_UNITS } from "@/lib/constants";
import { titleLength, titleTooLong } from "@/lib/title-clamp";
import { cn } from "../ui/cn";

/**
 * Los campos de título dejan seguir escribiendo o pegando por encima del máximo (se ve lo que hay), pero se ponen en rojo
 * y avisan; al guardar se recorta al máximo (clampTitle) y sale el aviso «Título recortado». Este tope (en unidades
 * UTF-16, lo que cuenta `maxLength`) solo evita pegados enormes: deja sitio de sobra para los emojis compuestos y las
 * menciones, que en el texto guardado ocupan más de lo que se ve.
 */
export const TITLE_INPUT_LIMIT = MAX_TITLE_UNITS * 2;

/** El título pasa del máximo: caracteres visibles (grafemas, sin lo que añaden las menciones) o el tope duro de unidades. */
export function overTitleLimit(value: string): boolean {
  return titleTooLong(value);
}

/** Clases del campo en rojo (mismo estilo que los demás campos con error). */
export const TITLE_INVALID_CLASSES = "border-red-500 text-red-700 focus:border-red-500 focus:ring-red-500/30 dark:border-red-500 dark:text-red-300";

/** Ayuda «n/máx» en rojo (n en caracteres visibles: un emoji de familia es uno); no pinta nada mientras el título cabe. El campo la enlaza con aria-describedby={id}. */
export function TitleLimitHint({ id, value, className }: { id: string; value: string; className?: string }) {
  if (!overTitleLimit(value)) return null;
  return (
    <p id={id} className={cn("text-xs font-medium text-red-600 dark:text-red-400", className)}>
      {titleLength(value)}/{MAX_TITLE}
    </p>
  );
}
