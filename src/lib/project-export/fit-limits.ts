// Importar un proyecto con los topes de la aplicación: el formato del archivo admite más columnas (200) y nombres de
// etiqueta y de tipo más largos (80) de los que deja crear la aplicación (30 columnas, src/actions/columns.ts; nombres de
// 40, labels y kinds). Lo que pasa de ahí se ajusta aquí, antes de importar, y se avisa en «Advertencias». Un archivo
// dentro de los topes (todos los que exporta la aplicación) no cambia. Sin base de datos; pruebas en
// tests/db/project-export.test.ts («con los topes de la aplicación»).
import { hasEvergreenTasks } from "../constants";
import { cutText } from "../graphemes";
import { POSITION_STEP } from "../positions";
import type { ProjectExportData } from "./types";

/** Columnas por proyecto (como «Añadir columna»: src/actions/columns.ts). */
export const IMPORT_MAX_COLUMNS = 30;
/** Nombre de una etiqueta o de un tipo (como al crearlos en la aplicación). */
export const IMPORT_MAX_NAME = 40;

interface FitReport {
  /** Columnas que sobraban y se han unido a la última que cabe (`into`), con sus tareas. */
  mergedColumns: { count: number; total: number; into: string } | null;
  /** Nombres recortados a IMPORT_MAX_NAME. */
  cutKindNames: number;
  cutLabelNames: number;
}

const cutName = (name: string) => cutText(name.trim(), IMPORT_MAX_NAME).trimEnd() || "?";

/**
 * Ajusta los datos del archivo a los topes de la aplicación. Columnas: se quedan las IMPORT_MAX_COLUMNS primeras (por
 * posición) y las demás se unen a la última de ellas, como hace «Aplicar plantilla» con las que se juntan en una: sus
 * tareas (archivadas incluidas) van al final de esa columna, en su orden; las archivadas recuerdan esa columna; lo que
 * apuntaba a una columna quitada (destino de las rutinas) apunta a ella, y las tareas fijas dejan de serlo si esa columna
 * no admite fijas. Nombres de tipo y de etiqueta: recortados; dos etiquetas que quedan con el mismo nombre se unen.
 */
export function fitImportLimits(data: ProjectExportData): { data: ProjectExportData; report: FitReport } {
  const report: FitReport = { mergedColumns: null, cutKindNames: 0, cutLabelNames: 0 };
  let out = data;

  if (data.columns.length > IMPORT_MAX_COLUMNS) {
    const ordered = data.columns.map((c, i) => ({ c, i })).sort((a, b) => a.c.position - b.c.position || a.i - b.i).map((x) => x.c);
    const kept = ordered.slice(0, IMPORT_MAX_COLUMNS);
    const extra = ordered.slice(IMPORT_MAX_COLUMNS);
    const last = kept.at(-1)!;
    const extraOrder = new Map(extra.map((c, i) => [c.ref, i]));
    const to = (ref: string) => (extraOrder.has(ref) ? last.ref : ref);
    const moved = data.tasks
      .filter((x) => extraOrder.has(x.columnRef))
      .sort((a, b) => extraOrder.get(a.columnRef)! - extraOrder.get(b.columnRef)! || a.position - b.position);
    let pos = Math.max(0, ...data.tasks.filter((x) => x.columnRef === last.ref).map((x) => x.position));
    const newPos = new Map(moved.map((x) => [x.ref, (pos += POSITION_STEP)]));
    const pinnable = hasEvergreenTasks(last.role);
    const keptRefs = new Set(kept.map((c) => c.ref));
    out = {
      ...out,
      columns: data.columns.filter((c) => keptRefs.has(c.ref)).map((c) => (c.routineTargetRef && extraOrder.has(c.routineTargetRef) ? { ...c, routineTargetRef: last.ref } : c)),
      tasks: data.tasks.map((x) => {
        if (!newPos.has(x.ref) && !(x.archivedFromColumnRef && extraOrder.has(x.archivedFromColumnRef)) && !(x.routineColumnRef && extraOrder.has(x.routineColumnRef))) return x;
        const merged = newPos.has(x.ref);
        return {
          ...x,
          columnRef: to(x.columnRef),
          ...(merged ? { position: newPos.get(x.ref)! } : {}),
          archivedFromColumnRef: x.archivedFromColumnRef ? to(x.archivedFromColumnRef) : null,
          ...(x.routineColumnRef ? { routineColumnRef: to(x.routineColumnRef) } : {}),
          ...(merged && x.evergreen && !pinnable ? { evergreen: false, evergreenEvery: 1 } : {}),
        };
      }),
    };
    report.mergedColumns = { count: extra.length, total: data.columns.length, into: last.name };
  }

  if (data.kinds.some((k) => k.name.length > IMPORT_MAX_NAME)) {
    out = {
      ...out,
      kinds: out.kinds.map((k) => {
        if (k.name.length <= IMPORT_MAX_NAME) return k;
        report.cutKindNames++;
        return { ...k, name: cutName(k.name) };
      }),
    };
  }

  if (data.labels.some((l) => l.name.length > IMPORT_MAX_NAME)) {
    // El nombre es único en el proyecto: una etiqueta que queda igual que otra se une a ella (sus tareas, a esa).
    const byName = new Map<string, string>();
    const alias = new Map<string, string>();
    const labels: ProjectExportData["labels"] = [];
    for (const l of out.labels) {
      const long = l.name.length > IMPORT_MAX_NAME;
      if (long) report.cutLabelNames++;
      const name = long ? cutName(l.name) : l.name;
      const same = byName.get(name);
      if (same) {
        alias.set(l.ref, same);
        continue;
      }
      byName.set(name, l.ref);
      labels.push(long ? { ...l, name } : l);
    }
    out = {
      ...out,
      labels,
      tasks: alias.size ? out.tasks.map((x) => (x.labelRefs.some((r) => alias.has(r)) ? { ...x, labelRefs: [...new Set(x.labelRefs.map((r) => alias.get(r) ?? r))] } : x)) : out.tasks,
    };
  }

  return { data: out, report };
}
