// «Aplicar plantilla» a un proyecto que ya existe (Ajustes del proyecto → Tablero): qué se haría, sin tocar la base de
// datos. Lo usan el asistente en el navegador (para enseñar el emparejamiento y el resumen antes de aplicar) y el
// servidor (lib/template-apply.ts), que vuelve a calcularlo dentro de la transacción con los datos del momento. Sin zod
// ni dependencias de Node.
//
// Dos modos:
// - ADD («Añadir lo que falte»): añade las columnas, tipos, etiquetas, campos y plantillas de release de la plantilla que
//   el proyecto no tenga y vuelve a mostrar los tipos generales que la plantilla usa y el proyecto oculta, sin cambiar
//   ni quitar nada más.
// - REPLACE («Cambiar a esta plantilla»): cada columna actual se empareja con una de la plantilla (sus tareas pasan a
//   ella), se conserva al final o, si está vacía, se quita; lo mismo con los tipos. Nunca se quita nada que tenga tareas.
//
// Nada depende de una lista fija de roles: los roles se comparan tal cual y solo `isUniqueColumnRole` dice cuáles no
// pueden repetirse, así que una plantilla con un rol nuevo funciona sin tocar este módulo.
import { hasEvergreenTasks, isUniqueColumnRole, MAX_LABELS_PER_PROJECT, MAX_RELEASE_TEMPLATES_PER_KIND } from "./constants";
import { normalizeTaskFields, type TaskFieldKey } from "./task-fields";

/** Máximo de columnas y de tipos propios de un proyecto (los mismos topes que crear columnas y tipos a mano). */
const MAX_PROJECT_COLUMNS = 30;
const MAX_PROJECT_KINDS = 30;
/** Horas durante las que se puede deshacer el último cambio de plantilla. */
export const TEMPLATE_UNDO_HOURS = 24;

/** Plantilla elegida: un ejemplo de serie (para cualquiera) o una plantilla de la instalación (administradores). */
export type TemplateRef = { source: "example"; key: string } | { source: "template"; id: string };

/** Plantilla tal como la necesita el asistente (la forma de TemplateData, sin zod). */
export interface ApplyTemplateShape {
  name: string;
  columns: { name: string; role: string; isDone: boolean; wipLimit?: number | null }[];
  kinds: { name: string; color: string; titleTemplate: string; descriptionTemplate: string; subtaskTemplate: string[] }[];
  labels: { name: string; color: string }[];
  hiddenGeneralKinds: string[];
  hideAllGeneralKinds: boolean;
  taskFields: string[];
  releaseTemplates: { kind: "HEADER" | "FOOTER"; name: string; content: string }[];
}

/** Lo que tiene el proyecto ahora. Las columnas, por posición; `active`/`archived`: sus tareas. */
export interface ProjectShape {
  columns: { id: string; name: string; role: string; isDone: boolean; wipLimit: number | null; active: number; archived: number }[];
  /** Tipos generales (todos, con si el proyecto los oculta) y propios. `label`: nombre visible (traducido); `tasks`: del proyecto, archivadas incluidas. */
  kinds: { id: string; name: string; label: string; general: boolean; hidden: boolean; tasks: number }[];
  labels: { id: string; name: string; tasks: number }[];
  releaseTemplates: { kind: "HEADER" | "FOOTER"; name: string }[];
  taskFields: string[];
  /** Tareas fijas («Siempre en la release»), archivadas incluidas: solo existen en la columna de release. */
  evergreen?: { id: string; title: string; columnId: string }[];
}

export type ApplyMode = "ADD" | "REPLACE";

/**
 * Elección para cada columna actual: `t:<i>` (sus tareas pasan a la columna i de la plantilla), `keep` (se conserva al
 * final) o `drop` (se quita; solo si está vacía). Para cada tipo: `t:<i>` (tipo i de la plantilla), `g:<id>` (un tipo
 * general), `keep` o `drop` (solo un tipo propio sin tareas).
 */
export interface ApplyChoices {
  columns: Record<string, string>;
  kinds: Record<string, string>;
}

/** Nombre normalizado para emparejar: sin mayúsculas, tildes ni espacios sobrantes. */
export function nameKey(s: string): string {
  return s.normalize("NFD").replace(/\p{M}/gu, "").replace(/\s+/g, " ").trim().toLowerCase();
}

const totalTasks = (c: { active: number; archived: number }) => c.active + c.archived;

// ---------------------------------------------------------------------------------------------------------------------
// Sugerencias

/**
 * Columna de la plantilla que se sugiere para cada columna actual: la del mismo nombre; si no, la primera con el mismo rol
 * (si tiene alguno); si no y la actual cuenta como terminada, la primera terminada. Sin pareja: `keep` si tiene tareas y
 * `drop` si está vacía.
 */
export function suggestColumnChoices(project: Pick<ProjectShape, "columns">, template: Pick<ApplyTemplateShape, "columns">): Record<string, string> {
  const byName = new Map<string, number>();
  template.columns.forEach((c, i) => { if (!byName.has(nameKey(c.name))) byName.set(nameKey(c.name), i); });
  const out: Record<string, string> = {};
  for (const col of project.columns) {
    let to = byName.get(nameKey(col.name));
    if (to === undefined && col.role !== "NONE") {
      const i = template.columns.findIndex((t) => t.role === col.role);
      if (i >= 0) to = i;
    }
    if (to === undefined && col.isDone) {
      const i = template.columns.findIndex((t) => t.isDone);
      if (i >= 0) to = i;
    }
    out[col.id] = to !== undefined ? `t:${to}` : totalTasks(col) > 0 ? "keep" : "drop";
  }
  return out;
}

/** A qué tipo de la plantilla corresponde cada uno de la plantilla (índice): uno propio o general del mismo nombre, o nuevo. */
export function resolveTemplateKinds(project: Pick<ProjectShape, "kinds">, template: Pick<ApplyTemplateShape, "kinds">): ({ existing: string } | { create: true })[] {
  const own = new Map(project.kinds.filter((k) => !k.general).map((k) => [nameKey(k.name), k.id]));
  const general = new Map<string, string>();
  for (const k of project.kinds.filter((k) => k.general)) {
    general.set(nameKey(k.name), k.id);
    general.set(nameKey(k.label), k.id);
  }
  return template.kinds.map((k) => {
    const id = own.get(nameKey(k.name)) ?? general.get(nameKey(k.name));
    return id ? { existing: id } : { create: true as const };
  });
}

/**
 * Tipo sugerido para cada tipo actual que el asistente enseña (los propios y los generales visibles o con tareas): el
 * de la plantilla con el mismo nombre; si no, `keep`, o `drop` si es propio y no tiene tareas.
 */
export function suggestKindChoices(project: Pick<ProjectShape, "kinds">, template: Pick<ApplyTemplateShape, "kinds">): Record<string, string> {
  const byName = new Map<string, number>();
  template.kinds.forEach((k, i) => { if (!byName.has(nameKey(k.name))) byName.set(nameKey(k.name), i); });
  const out: Record<string, string> = {};
  for (const k of listedKinds(project)) {
    const i = byName.get(nameKey(k.name)) ?? byName.get(nameKey(k.label));
    out[k.id] = i !== undefined ? `t:${i}` : !k.general && k.tasks === 0 ? "drop" : "keep";
  }
  return out;
}

/** Tipos actuales que se pueden emparejar: los propios y los generales que el proyecto usa (visibles o con tareas). */
export function listedKinds<K extends ProjectShape["kinds"][number]>(project: { kinds: K[] }): K[] {
  return project.kinds.filter((k) => !k.general || !k.hidden || k.tasks > 0);
}

/** Tipos generales que la plantilla oculta (ids), sin contar los que tienen tareas ni a los que van tareas. */
function templateHiddenGenerals(project: Pick<ProjectShape, "kinds">, template: Pick<ApplyTemplateShape, "hiddenGeneralKinds" | "hideAllGeneralKinds">): string[] {
  const names = new Set(template.hiddenGeneralKinds.map(nameKey));
  return project.kinds
    .filter((k) => k.general && (template.hideAllGeneralKinds || names.has(nameKey(k.name)) || names.has(nameKey(k.label))))
    .map((k) => k.id);
}

/** Tipos generales que siguen visibles con la plantilla (destinos posibles de las tareas, además de los de la plantilla). */
export function visibleGeneralsAfter(project: Pick<ProjectShape, "kinds">, template: Pick<ApplyTemplateShape, "hiddenGeneralKinds" | "hideAllGeneralKinds">) {
  const hidden = new Set(templateHiddenGenerals(project, template));
  return project.kinds.filter((k) => k.general && !hidden.has(k.id));
}

/**
 * Tipos generales que usa la plantilla (ids): los que no oculta y aquellos con los que coincide uno de sus tipos (por
 * nombre). «Añadir lo que falte» vuelve a mostrar los que el proyecto tenga ocultos.
 */
function templateUsedGenerals(project: Pick<ProjectShape, "kinds">, template: Pick<ApplyTemplateShape, "kinds" | "hiddenGeneralKinds" | "hideAllGeneralKinds">): Set<string> {
  const hidden = new Set(templateHiddenGenerals(project, template));
  const used = new Set(project.kinds.filter((k) => k.general && !hidden.has(k.id)).map((k) => k.id));
  const generalIds = new Set(project.kinds.filter((k) => k.general).map((k) => k.id));
  for (const t of resolveTemplateKinds(project, template)) if ("existing" in t && generalIds.has(t.existing)) used.add(t.existing);
  return used;
}

// ---------------------------------------------------------------------------------------------------------------------
// Planes

interface CommonPlan {
  /** Etiquetas de la plantilla que faltan. */
  addLabels: { name: string; color: string }[];
  /** Plantillas de release que faltan (sin pasar de MAX_RELEASE_TEMPLATES_PER_KIND de cada tipo). */
  addReleaseTemplates: { kind: "HEADER" | "FOOTER"; name: string; content: string }[];
  /** Campos opcionales finales y los que se activan. */
  taskFields: TaskFieldKey[];
  addedFields: TaskFieldKey[];
  /** Problemas que impiden aplicar (textos traducibles con sus variables). */
  errors: { text: string; vars?: Record<string, string | number> }[];
}

export interface AddPlan extends CommonPlan {
  mode: "ADD";
  addColumns: { index: number; name: string; role: string; isDone: boolean; wipLimit: number | null }[];
  addKinds: number[];
  /** Tipos generales que el proyecto oculta y la plantilla usa: vuelven a verse. */
  showGenerals: string[];
}

export interface ReplacePlan extends CommonPlan {
  mode: "REPLACE";
  /** Columnas finales de la plantilla, en orden: la actual que se reutiliza (la primera emparejada) o una nueva. */
  columns: {
    index: number; name: string; role: string; isDone: boolean; wipLimit: number | null;
    reuse: string | null;
    /** Columnas actuales cuyas tareas pasan a esta y que después se quitan. */
    absorb: string[];
    /** Tareas activas que llegan de otras columnas (las de `absorb`). */
    incoming: number;
  }[];
  /** Columnas actuales que se conservan al final, en su orden; `role`: el que tendrán (pierden uno único que la plantilla ya usa). */
  kept: { id: string; name: string; role: string; roleCleared: boolean }[];
  /** Columnas vacías que se quitan sin más. */
  dropColumns: string[];
  /** Tipos de la plantilla: el existente que le corresponde o uno nuevo. */
  kindTargets: ({ existing: string } | { create: true })[];
  /** Tareas que cambian de tipo: de `from` a un tipo existente (`to`) o al nuevo de la plantilla `toNew`. */
  kindMoves: { from: string; to: string | null; toNew: number | null; tasks: number }[];
  /** Tipos propios que se quitan (sin tareas tras los cambios). */
  dropKinds: string[];
  /** Tipos generales que pasan a ocultos y los que vuelven a verse. */
  hideGenerals: string[];
  showGenerals: string[];
  /** Etiquetas sin uso que no están en la plantilla. */
  removeLabels: string[];
  /** Tareas fijas cuya columna final no es la de release: pasan a ser normales. */
  unpinTasks: string[];
}

function commonPlan(project: ProjectShape, template: ApplyTemplateShape, removedLabels: number): CommonPlan {
  const labels = new Set(project.labels.map((l) => nameKey(l.name)));
  const addLabels: CommonPlan["addLabels"] = [];
  for (const l of template.labels) {
    if (labels.has(nameKey(l.name))) continue;
    labels.add(nameKey(l.name));
    addLabels.push({ name: l.name, color: l.color });
  }
  const addReleaseTemplates: CommonPlan["addReleaseTemplates"] = [];
  for (const kind of ["HEADER", "FOOTER"] as const) {
    const have = project.releaseTemplates.filter((r) => r.kind === kind);
    const names = new Set(have.map((r) => nameKey(r.name)));
    let room = MAX_RELEASE_TEMPLATES_PER_KIND - have.length;
    for (const r of template.releaseTemplates.filter((x) => x.kind === kind)) {
      if (room <= 0 || names.has(nameKey(r.name))) continue;
      names.add(nameKey(r.name));
      addReleaseTemplates.push(r);
      room--;
    }
  }
  const current = normalizeTaskFields(project.taskFields);
  const taskFields = normalizeTaskFields([...current, ...template.taskFields]);
  const errors: CommonPlan["errors"] = [];
  if (project.labels.length - removedLabels + addLabels.length > MAX_LABELS_PER_PROJECT) {
    errors.push({ text: "No caben las etiquetas de la plantilla: el máximo es {max} por proyecto.", vars: { max: MAX_LABELS_PER_PROJECT } });
  }
  return { addLabels, addReleaseTemplates, taskFields, addedFields: taskFields.filter((f) => !current.includes(f)), errors };
}

/**
 * «Añadir lo que falte»: columnas de la plantilla sin ninguna actual del mismo nombre (o con su rol, si tiene uno), tipos
 * sin ninguno propio ni general del mismo nombre, etiquetas, plantillas de release y campos; además, los tipos generales
 * que la plantilla usa y el proyecto tiene ocultos vuelven a verse. Lo demás no cambia.
 */
export function planAdd(project: ProjectShape, template: ApplyTemplateShape): AddPlan {
  const names = new Set(project.columns.map((c) => nameKey(c.name)));
  const roles = new Set(project.columns.map((c) => c.role).filter((r) => r !== "NONE"));
  const addColumns: AddPlan["addColumns"] = [];
  template.columns.forEach((c, index) => {
    if (names.has(nameKey(c.name)) || (c.role !== "NONE" && roles.has(c.role))) return;
    names.add(nameKey(c.name));
    if (c.role !== "NONE") roles.add(c.role);
    addColumns.push({ index, name: c.name, role: c.role, isDone: c.isDone, wipLimit: c.wipLimit ?? null });
  });
  const addKinds = resolveTemplateKinds(project, template).flatMap((r, i) => ("create" in r ? [i] : []));
  const used = templateUsedGenerals(project, template);
  const showGenerals = project.kinds.filter((k) => k.general && k.hidden && used.has(k.id)).map((k) => k.id);
  const common = commonPlan(project, template, 0);
  if (project.columns.length + addColumns.length > MAX_PROJECT_COLUMNS) common.errors.push({ text: "No caben las columnas de la plantilla: el máximo es {max} por proyecto.", vars: { max: MAX_PROJECT_COLUMNS } });
  const ownKinds = project.kinds.filter((k) => !k.general).length;
  if (ownKinds + addKinds.length > MAX_PROJECT_KINDS) common.errors.push({ text: "No caben los tipos de la plantilla: el máximo es {max} tipos propios por proyecto.", vars: { max: MAX_PROJECT_KINDS } });
  return { mode: "ADD", addColumns, addKinds, showGenerals, ...common };
}

/** Índice de `t:<i>` si es válido. */
function templateIndex(choice: string | undefined, length: number): number | null {
  const m = /^t:(\d+)$/.exec(choice ?? "");
  if (!m) return null;
  const i = Number(m[1]);
  return i < length ? i : null;
}

/**
 * «Cambiar a esta plantilla»: las elecciones que falten (o no válidas) toman la sugerencia. Una columna o un tipo con tareas
 * nunca se quita: `drop` vale como `keep`.
 */
export function planReplace(project: ProjectShape, template: ApplyTemplateShape, choices: Partial<ApplyChoices> = {}): ReplacePlan {
  const colSuggest = suggestColumnChoices(project, template);
  const columns: ReplacePlan["columns"] = template.columns.map((c, index) => ({
    index, name: c.name, role: c.role, isDone: c.isDone, wipLimit: c.wipLimit ?? null, reuse: null, absorb: [], incoming: 0,
  }));
  const kept: ReplacePlan["kept"] = [];
  const dropColumns: string[] = [];
  const templateRoles = new Set(template.columns.map((c) => c.role));
  const sources = new Map<number, ProjectShape["columns"]>();
  for (const col of project.columns) {
    const choice = choices.columns?.[col.id];
    const valid = choice === "keep" || choice === "drop" || templateIndex(choice, columns.length) !== null;
    const pick = valid ? choice! : colSuggest[col.id]!;
    const to = templateIndex(pick, columns.length);
    if (to !== null) {
      sources.set(to, [...(sources.get(to) ?? []), col]);
    } else if (pick === "drop" && totalTasks(col) === 0) {
      dropColumns.push(col.id);
    } else {
      const clear = col.role !== "NONE" && isUniqueColumnRole(col.role) && templateRoles.has(col.role);
      kept.push({ id: col.id, name: col.name, role: clear ? "NONE" : col.role, roleCleared: clear });
    }
  }
  // Si varias columnas van a la misma, se reutiliza la que ya se llama como ella (o la primera) y las demás le pasan sus tareas.
  for (const [to, list] of sources) {
    const target = columns[to]!;
    const reuse = list.find((c) => nameKey(c.name) === nameKey(target.name)) ?? list[0]!;
    target.reuse = reuse.id;
    for (const c of list) {
      if (c === reuse) continue;
      target.absorb.push(c.id);
      target.incoming += c.active;
    }
  }

  // Tareas fijas: siguen siéndolo solo si su columna acaba con el rol de release.
  const finalRole = new Map<string, string>();
  for (const [to, list] of sources) for (const c of list) finalRole.set(c.id, columns[to]!.role);
  for (const k of kept) finalRole.set(k.id, k.role);
  const unpinTasks = (project.evergreen ?? []).filter((t) => !hasEvergreenTasks(finalRole.get(t.columnId))).map((t) => t.id);

  // Tipos.
  const kindTargets = resolveTemplateKinds(project, template);
  const kindSuggest = suggestKindChoices(project, template);
  const generalIds = new Set(project.kinds.filter((k) => k.general).map((k) => k.id));
  const kindMoves: ReplacePlan["kindMoves"] = [];
  const dropKinds: string[] = [];
  const remaining = new Map(project.kinds.map((k) => [k.id, k.tasks]));
  // Primera pasada: qué elige cada tipo y a cuál irían sus tareas.
  const picks = listedKinds(project).map((k) => {
    const choice = choices.kinds?.[k.id];
    const gm = /^g:(.+)$/.exec(choice ?? "");
    const valid = choice === "keep" || choice === "drop" || templateIndex(choice, template.kinds.length) !== null || (!!gm && generalIds.has(gm[1]!));
    const pick = valid ? choice! : kindSuggest[k.id]!;
    const ti = templateIndex(pick, template.kinds.length);
    const g = /^g:(.+)$/.exec(pick)?.[1];
    const target = ti !== null ? kindTargets[ti]! : g ? { existing: g } : null;
    return { k, pick, ti, to: target && "existing" in target ? target.existing : null, moves: !!target };
  });
  // Un tipo que recibe tareas (o al que corresponde uno de la plantilla) se queda como está: sin cadenas ni tipos que se
  // quitan después de recibir tareas.
  const receiving = new Set<string>();
  for (const t of kindTargets) if ("existing" in t) receiving.add(t.existing);
  for (const p of picks) if (p.moves && p.to && p.to !== p.k.id) receiving.add(p.to);
  for (const { k, pick, ti, to, moves } of picks) {
    if (receiving.has(k.id) || (moves && to === k.id)) continue;
    if (moves) {
      if (k.tasks > 0) kindMoves.push({ from: k.id, to, toNew: to ? null : ti, tasks: k.tasks });
      remaining.set(k.id, 0);
      if (!k.general) dropKinds.push(k.id);
    } else if (pick === "drop" && !k.general && k.tasks === 0) {
      dropKinds.push(k.id);
    }
  }
  // Los generales que la plantilla oculta, salvo los que conservan o reciben tareas (o a los que corresponde un tipo de la plantilla).
  const wantHidden = new Set(templateHiddenGenerals(project, template).filter((id) => !(remaining.get(id) ?? 0) && !receiving.has(id)));
  // Siempre debe quedar algún tipo usable: si no, se deja visible el primer general (como al crear un proyecto).
  const ownLeft = project.kinds.filter((k) => !k.general && !dropKinds.includes(k.id)).length + kindTargets.filter((t) => "create" in t).length;
  const generals = project.kinds.filter((k) => k.general);
  if (ownLeft === 0 && generals.length && generals.every((k) => wantHidden.has(k.id))) wantHidden.delete(generals[0]!.id);
  const hideGenerals = generals.filter((k) => !k.hidden && wantHidden.has(k.id)).map((k) => k.id);
  const showGenerals = generals.filter((k) => k.hidden && !wantHidden.has(k.id)).map((k) => k.id);

  // Etiquetas sin uso que la plantilla no trae.
  const templateLabels = new Set(template.labels.map((l) => nameKey(l.name)));
  const removeLabels = project.labels.filter((l) => l.tasks === 0 && !templateLabels.has(nameKey(l.name))).map((l) => l.id);
  const common = commonPlan(project, template, removeLabels.length);
  if (columns.length + kept.length > MAX_PROJECT_COLUMNS) {
    common.errors.push({ text: "Quedarían {n} columnas y el máximo es {max}: quita o empareja alguna de las que se conservan.", vars: { n: columns.length + kept.length, max: MAX_PROJECT_COLUMNS } });
  }
  if (ownLeft > MAX_PROJECT_KINDS) common.errors.push({ text: "No caben los tipos de la plantilla: el máximo es {max} tipos propios por proyecto.", vars: { max: MAX_PROJECT_KINDS } });
  if (!columns.length) common.errors.push({ text: "La plantilla no tiene columnas." });
  return { mode: "REPLACE", columns, kept, dropColumns, kindTargets, kindMoves, dropKinds, hideGenerals, showGenerals, removeLabels, unpinTasks, ...common };
}

// ---------------------------------------------------------------------------------------------------------------------
// Resumen

/** Una línea del resumen: texto traducible con {n} (y a veces una lista de nombres para la nota). */
interface SummaryLine {
  text: string;
  n: number;
  names?: string[];
}

/** Líneas del resumen («Se moverán 34 tareas…»), solo las que no son cero, en el orden en que se leen. */
export function summarizePlan(plan: AddPlan | ReplacePlan, project: ProjectShape, template: ApplyTemplateShape): SummaryLine[] {
  const lines: SummaryLine[] = [];
  const add = (n: number, one: string, many: string, names?: string[]) => {
    if (n > 0) lines.push({ text: n === 1 ? one : many, n, ...(names?.length ? { names } : {}) });
  };
  const colName = new Map(project.columns.map((c) => [c.id, c.name]));
  const kindName = new Map(project.kinds.map((k) => [k.id, k.label]));
  const labelName = new Map(project.labels.map((l) => [l.id, l.name]));
  if (plan.mode === "ADD") {
    add(plan.addColumns.length, "Se añadirá {n} columna", "Se añadirán {n} columnas", plan.addColumns.map((c) => c.name));
    add(plan.addKinds.length, "Se añadirá {n} tipo de tarea", "Se añadirán {n} tipos de tarea", plan.addKinds.map((i) => template.kinds[i]!.name));
    add(plan.showGenerals.length, "Volverá a verse {n} tipo general", "Volverán a verse {n} tipos generales", plan.showGenerals.map((id) => kindName.get(id)!));
  } else {
    const created = plan.columns.filter((c) => c.reuse === null);
    const adapted = plan.columns.filter((c) => {
      if (!c.reuse) return false;
      const cur = project.columns.find((x) => x.id === c.reuse)!;
      return cur.name !== c.name || cur.role !== c.role || cur.isDone !== c.isDone || (c.wipLimit !== null && c.wipLimit !== cur.wipLimit);
    });
    const moved = plan.columns.reduce((s, c) => s + c.incoming, 0);
    const removed = [...plan.columns.flatMap((c) => c.absorb), ...plan.dropColumns];
    add(moved, "Se moverá {n} tarea a otra columna", "Se moverán {n} tareas a otra columna");
    add(created.length, "Se añadirá {n} columna", "Se añadirán {n} columnas", created.map((c) => c.name));
    add(adapted.length, "Se adaptará {n} columna a la plantilla (nombre, rol u orden)", "Se adaptarán {n} columnas a la plantilla (nombre, rol u orden)", adapted.map((c) => (colName.get(c.reuse!) === c.name ? c.name : `${colName.get(c.reuse!)} → ${c.name}`)));
    add(removed.length, "Se quitará {n} columna que se queda vacía", "Se quitarán {n} columnas que se quedan vacías", removed.map((id) => colName.get(id)!));
    add(plan.kept.length, "Se conservará al final {n} columna sin pareja", "Se conservarán al final {n} columnas sin pareja", plan.kept.map((c) => c.name));
    add(plan.kept.filter((c) => c.roleCleared).length, "{n} columna conservada pierde su rol (la plantilla ya lo usa)", "{n} columnas conservadas pierden su rol (la plantilla ya lo usa)", plan.kept.filter((c) => c.roleCleared).map((c) => c.name));
    const pinned = new Map((project.evergreen ?? []).map((t) => [t.id, t.title]));
    add(plan.unpinTasks.length, "{n} tarea fija pasará a ser normal (su columna deja de admitir tareas fijas)", "{n} tareas fijas pasarán a ser normales (su columna deja de admitir tareas fijas)", someNames(plan.unpinTasks.map((id) => pinned.get(id)!)));
    const createdKinds = plan.kindTargets.flatMap((t, i) => ("create" in t ? [template.kinds[i]!.name] : []));
    add(createdKinds.length, "Se añadirá {n} tipo de tarea", "Se añadirán {n} tipos de tarea", createdKinds);
    add(plan.kindMoves.reduce((s, m) => s + m.tasks, 0), "Cambiará de tipo {n} tarea", "Cambiarán de tipo {n} tareas");
    add(plan.dropKinds.length, "Se quitará {n} tipo propio que se queda sin tareas", "Se quitarán {n} tipos propios que se quedan sin tareas", plan.dropKinds.map((id) => kindName.get(id)!));
    add(plan.hideGenerals.length, "Se ocultará {n} tipo general", "Se ocultarán {n} tipos generales", plan.hideGenerals.map((id) => kindName.get(id)!));
    add(plan.showGenerals.length, "Volverá a verse {n} tipo general", "Volverán a verse {n} tipos generales", plan.showGenerals.map((id) => kindName.get(id)!));
  }
  add(plan.addLabels.length, "Se añadirá {n} etiqueta", "Se añadirán {n} etiquetas", plan.addLabels.map((l) => l.name));
  if (plan.mode === "REPLACE") add(plan.removeLabels.length, "Se quitará {n} etiqueta sin uso", "Se quitarán {n} etiquetas sin uso", plan.removeLabels.map((id) => labelName.get(id)!));
  add(plan.addedFields.length, "Se activará {n} campo opcional", "Se activarán {n} campos opcionales");
  add(plan.addReleaseTemplates.length, "Se añadirá {n} plantilla de release", "Se añadirán {n} plantillas de release", plan.addReleaseTemplates.map((r) => r.name));
  return lines;
}

/** Como mucho SUMMARY_NAMES nombres (cada uno recortado) y «…» si hay más: los títulos de tareas pueden ser muchos y largos. */
const SUMMARY_NAMES = 10;
function someNames(names: string[]): string[] {
  const cut = names.slice(0, SUMMARY_NAMES).map((n) => (n.length > 60 ? `${n.slice(0, 59)}…` : n));
  return names.length > SUMMARY_NAMES ? [...cut, "…"] : cut;
}

/** ¿El plan no cambia nada? */
export function planIsEmpty(plan: AddPlan | ReplacePlan, project: ProjectShape, template: ApplyTemplateShape): boolean {
  return summarizePlan(plan, project, template).length === 0 && (plan.mode === "ADD" || !reordersColumns(plan, project));
}

/** En REPLACE, ¿cambia el orden de las columnas aunque no se añada ni quite ninguna? */
function reordersColumns(plan: ReplacePlan, project: ProjectShape): boolean {
  const final = [...plan.columns.map((c) => c.reuse), ...plan.kept.map((c) => c.id)];
  return final.join() !== project.columns.filter((c) => !plan.dropColumns.includes(c.id)).map((c) => c.id).join();
}
