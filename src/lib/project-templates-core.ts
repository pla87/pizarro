// Límites de las plantillas de proyecto, sin zod: los usa el editor de plantillas en el navegador (los esquemas que los
// aplican están en project-templates.ts, solo en el servidor).

export const MAX_TEMPLATE_COLUMNS = 20;
export const MAX_TEMPLATE_KINDS = 30;
export const MAX_TEMPLATE_LABELS = 50;
/** Máximo de plantillas (de serie y propias): crear una o recuperar las de serie no pasa de aquí. */
export const MAX_TEMPLATES = 50;

// --- Tipos generales en el editor de plantillas ---
// Se guardan en sentido negativo (los que se ocultan y «ocultar todos»), pero el editor los muestra en positivo, como los
// ajustes del proyecto («Tipos generales que se usan»: marcado = se usa). Con «ocultar todos» la lista de ocultos no
// cuenta (buildTemplateApplication oculta todos): el editor los muestra todos sin marcar, sin contradicciones.

type GeneralKindsChoice = { hiddenGeneralKinds: string[]; hideAllGeneralKinds: boolean };

/** ¿La plantilla usa el tipo general `name`? */
export function generalKindUsed(tpl: GeneralKindsChoice, name: string): boolean {
  return !tpl.hideAllGeneralKinds && !tpl.hiddenGeneralKinds.includes(name);
}

/**
 * Marcar o desmarcar «se usa» en el tipo general `name` (`generals`: los nombres de los tipos generales que existen).
 * Marcar uno con «ocultar todos» deja de ocultarlos todos y oculta los demás (solo se usa ese).
 */
export function setGeneralKindUsed(tpl: GeneralKindsChoice, generals: readonly string[], name: string, used: boolean): GeneralKindsChoice {
  if (!used) {
    if (!generalKindUsed(tpl, name)) return tpl;
    return { hideAllGeneralKinds: false, hiddenGeneralKinds: [...tpl.hiddenGeneralKinds, name] };
  }
  if (tpl.hideAllGeneralKinds) {
    // Los nombres guardados que ya no existen como tipo general se conservan (el editor los muestra aparte).
    const gone = tpl.hiddenGeneralKinds.filter((n) => !generals.includes(n));
    return { hideAllGeneralKinds: false, hiddenGeneralKinds: [...generals.filter((n) => n !== name), ...gone] };
  }
  return { hideAllGeneralKinds: false, hiddenGeneralKinds: tpl.hiddenGeneralKinds.filter((n) => n !== name) };
}
