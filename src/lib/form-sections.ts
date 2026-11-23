// Apartados del formulario de un tipo de tarea («**Por qué:**», «**Quién:**»…) en una descripción en Markdown: quitar los que
// siguen sin responder. Lo usan el plan de trabajo para IA (ai-plan.ts) y el PDF «Generar plan» (column-assign-core.ts).
// Sin zod: también va al navegador.
import { BARE_MARKER } from "./kinds-special";

/** Apertura de un bloque de código: hasta 3 espacios y 3 o más ``` o ~~~ (con ```, sin más ` en la información). */
export const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})(.*)$/;
/** Cierre: el mismo carácter, al menos tantos como la apertura y nada más que espacios. */
export const FENCE_CLOSE = /^ {0,3}(`{3,}|~{3,})\s*$/;

/** Etiqueta de formulario sola en su línea («**Por qué:**» o «**Por qué**:»), como las de los tipos. */
export const FORM_LABEL_ONLY = /^\*\*[^*\n]+(?::\*\*|\*\*:)$/;
/** Etiqueta de formulario, sola o con la respuesta detrás («**Riesgo:** ninguno»); no una negrita sin «:» («**1.** Abrir»). */
const FORM_LABEL = /^\*\*[^*\n]+(?::\*\*|\*\*:)/;

/**
 * Sin los apartados del formulario del tipo que siguen sin responder: una línea que es solo una etiqueta en negrita
 * («**Por qué:**») y lo que tenga debajo hasta la siguiente etiqueta, si son solo líneas en blanco o viñetas y casillas
 * vacías (el criterio de `switchKindDescription`). No dicen nada a la IA, que además no sabe si debe rellenarlos. Los
 * apartados con algo escrito (también en la misma línea: «**Riesgo:** sin cambios…») se quedan, y dentro de un bloque
 * de código no se toca nada.
 */
export function withoutEmptyFormSections(lines: readonly string[]): string[] {
  const out: string[] = [];
  let fence: string | null = null;
  /** Dónde empieza en `out` el apartado sin respuesta en curso (su etiqueta). */
  let pending: number | null = null;
  for (const raw of lines) {
    const l = raw.trim();
    if (fence) {
      const close = FENCE_CLOSE.exec(raw)?.[1];
      if (close && close[0] === fence[0] && close.length >= fence.length) fence = null;
      out.push(raw);
      continue;
    }
    if (pending !== null) {
      if (!l || BARE_MARKER.test(l)) {
        out.push(raw);
        continue;
      }
      // La siguiente etiqueta cierra el apartado vacío (se quita); cualquier otra cosa (también un texto que empieza en
      // negrita, «**1.** Abrir ajustes») es su respuesta.
      if (FORM_LABEL.test(l)) out.length = pending;
      pending = null;
    }
    const open = FENCE_OPEN.exec(raw);
    if (open && !(open[1]![0] === "`" && open[2]!.includes("`"))) fence = open[1]!;
    else if (FORM_LABEL_ONLY.test(l)) pending = out.length;
    out.push(raw);
  }
  if (pending !== null) out.length = pending;
  return out;
}
