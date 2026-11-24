// Límites de las plantillas de proyecto, sin zod: los usa el editor de plantillas en el navegador (los esquemas que los
// aplican están en project-templates.ts, solo en el servidor).

/** El mismo tope que un proyecto (`columns.ts`): «Crear plantilla desde un proyecto» no deja columnas fuera. */
export const MAX_TEMPLATE_COLUMNS = 30;
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

// --- «Tipo por defecto» de las columnas al renombrar o quitar un tipo propio ---
// Las columnas guardan el nombre del tipo: sin esto, al renombrar «Bug» a «Fallo» la columna seguía con «Bug» (un nombre
// que ya no existe y que al aplicar la plantilla se ignoraba sin aviso).

type DefaultKindColumn = { key: string; defaultKind?: string | null };
const kindKey = (name: string | null | undefined) => (name ?? "").trim().toLowerCase();

/**
 * Renombrar un tipo propio de `from` a `to`: las columnas que lo tenían por defecto pasan al nombre nuevo, salvo que otro
 * tipo (`others`: los demás propios y los generales que se usan) se siga llamando como el anterior. Al borrar el nombre
 * entero, esas columnas se quedan sin tipo por defecto y se devuelven en `orphans`, para dárselo de nuevo al escribir el
 * nombre nuevo (pasarlas con `orphans` cuando `from` está vacío).
 */
export function followKindRename<C extends DefaultKindColumn>(columns: C[], from: string, to: string, others: readonly string[], orphans: readonly string[] = []): { columns: C[]; orphans: string[] } {
  // Un nombre a medio escribir que coincide con otro tipo («Bug crítico» → «Bug » con un tipo «Bug») cuenta como vacío: si
  // no, las columnas pasaban a ese otro tipo y ahí se quedaban.
  const typed = to.trim() || null;
  const next = typed && others.some((n) => kindKey(n) === kindKey(typed)) ? null : typed;
  if (orphans.length) {
    if (!next) return { columns, orphans: [...orphans] };
    return { columns: columns.map((c) => (orphans.includes(c.key) && !c.defaultKind ? { ...c, defaultKind: next } : c)), orphans: [] };
  }
  if (!kindKey(from)) return { columns, orphans: [] };
  if (kindKey(from) === kindKey(to) && next === from.trim()) return { columns, orphans: [] };
  if (others.some((n) => kindKey(n) === kindKey(from))) return { columns, orphans: [] };
  const hit = columns.filter((c) => kindKey(c.defaultKind) === kindKey(from)).map((c) => c.key);
  if (!hit.length) return { columns, orphans: [] };
  return { columns: columns.map((c) => (hit.includes(c.key) ? { ...c, defaultKind: next } : c)), orphans: next ? [] : hit };
}

/** Quitar un tipo propio: las columnas que lo tenían por defecto se quedan sin él (salvo que otro tipo se llame igual). */
export function dropColumnDefaultKind<C extends DefaultKindColumn>(columns: C[], name: string, others: readonly string[]): C[] {
  if (!kindKey(name) || others.some((n) => kindKey(n) === kindKey(name))) return columns;
  return columns.map((c) => (kindKey(c.defaultKind) === kindKey(name) ? { ...c, defaultKind: null } : c));
}
