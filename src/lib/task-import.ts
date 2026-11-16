import "server-only";
// Importar varias tareas como JSON («pizarro.tasks», ver lib/task-json.ts): el botón «Importar» del tablero (y Ctrl+V con
// tareas en JSON). Lo llama la ruta POST /api/projects/[projectId]/import-tasks, no una acción de servidor: las acciones
// admiten como mucho 1 MB (serverActions.bodySizeLimit en next.config.ts) y una exportación de 500 tareas con descripciones
// medianas ya pasa de ahí; la ruta lee el cuerpo con su propio tope (TASKS_TEXT_MAX_BYTES). Exportar (exportTasksJson)
// sigue en actions/task-json.ts; pegar una tarea sobre otra (pasteTaskJson), en actions/tasks.ts. Las reglas para pasar
// nombres a ids, en lib/task-json-resolve.ts (las mismas para pegar e importar).
import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import { db } from "./db";
import { runAction } from "./action";
import { assertProjectAccess } from "./access";
import { appTimeZone, loadBoardTasksByIds } from "./board";
import { describeAction, needOwnRefresh, recordTaskEvent } from "./action-context";
import { addUndo } from "./undo";
import { tasksN } from "./undo-label";
import { AppError } from "./errors";
import { positionBetween, POSITION_STEP } from "./positions";
import { lastPositionIn, lockColumns } from "./task-positions";
import { rateLimit } from "./rate-limit";
import { assertTaskCapacity } from "./caps";
import { assertColumnRoom } from "./column-capacity";
import { lockBlocking } from "./blocking";
import { requireUser } from "./session";
import * as v from "./validation";
import { isoToDate, todayIso } from "./dates";
import { normalizeRecurrence } from "./recurrence-date";
import { assignedBatchExcerpt } from "./notification-text";
import { notifyTask } from "./notify";
import { fieldData, pickTaskFields, type taskFieldSchema } from "./task-field-input";
import { excerpt as makeExcerpt, mentionsToPlain } from "./mentions";
import { getLocale, getT } from "@/i18n/server";
import { parseTasksText, TASK_READ_FAILURE, TASKS_JSON_MAX, TASKS_TEXT_MAX_CHARS } from "./task-json";
import { checkPastedTask, foldName, fromOtherProject, MAX_TASK_DOCS, PASTE_FIELD_NAME, pastedDocs, quoteName, TaskJsonResolver, type PastedTask, type ResolvedFields } from "./task-json-resolve";
import type { BoardTask } from "./types";

/** Avisos de etiquetas que no se pudieron crear que se dan por tarea; las demás se cuentan en uno solo. */
const LABEL_NOTICES_PER_TASK = 3;

const importOptions = z.object({ columnId: v.id.nullable().optional() }).strict();

/** Una tarea del texto lista para crear. */
interface ImportItem {
  n: number;
  title: string;
  fields: ResolvedFields;
  columnId: string;
  kindId: string;
  labelNames: string[];
  subtasks: { title: string; done: boolean }[];
  docs: { kind: Prisma.TaskLinkCreateManyInput["kind"]; title: string; url: string }[];
  json: PastedTask;
  skipped: string[];
}

/** Avisos de una tarea importada (lo que no se pudo aplicar) o motivo de una que no se importó. */
interface ImportNotice {
  n: number;
  title: string | null;
  text: string;
}

/** Lo que devuelve la importación (y la ruta, en JSON): las tareas creadas, los avisos de cada una y las que no se leyeron. */
export interface ImportTasksData {
  tasks: BoardTask[];
  notices: ImportNotice[];
  failed: ImportNotice[];
}

/**
 * Importa las tareas de un texto (lo pegado o el contenido de un fichero .json/.txt; ver parseTasksText) en el proyecto:
 * el texto se vuelve a leer aquí (nunca se usa lo que haya entendido el navegador). Cada tarea se crea con las mismas
 * reglas que al pegar una (TaskJsonResolver): nombres buscados solo en este proyecto, etiquetas que se crean si caben (50
 * por proyecto, 20 por tarea), 100 subtareas y 100 documentos de Google por tarea, campos opcionales activos. La crea
 * quien importa (`info.createdBy` del JSON es solo informativo). Columna: la de cada tarea si existe en el proyecto (si no,
 * la primera) o, con `columnId`, esa para todas; las columnas con tope («Programa del curso») se respetan. Una dependencia
 * hacia otra tarea del lote (por `info.id` o por título) apunta a la nueva; una de otro proyecto se ignora sin avisar.
 * Todo o nada para las tareas (tope del proyecto, tope de la columna), con un solo deshacer que las borra todas y también
 * las etiquetas que creó la importación si ya no las usa nadie. Devuelve las creadas y los avisos de cada una.
 *
 * Menciones: a propósito, importar NO avisa a las personas mencionadas (@nombre) en la descripción ni en las subtareas
 * (pegar sobre una tarea tampoco). Reimportar una exportación llenaría de avisos repetidos a quien ya los recibió en su
 * día. Sí se avisa al responsable asignado (uno por persona, no uno por tarea). No lo cambies sin pensarlo.
 *
 * Etiquetas que no se pueden crear: cada tarea que las pedía lo dice, como mucho LABEL_NOTICES_PER_TASK veces (el resto,
 * en un aviso con el número). Se reparte con un índice nombre → tareas: recorrer todas las tareas por cada etiqueta
 * fallida era cuadrático (500 tareas × 20 etiquetas no válidas bloqueaban el servidor decenas de segundos).
 *
 * La llama la ruta POST /api/projects/[projectId]/import-tasks (y las pruebas). Dentro de runAction, con el mismo nombre
 * que tenía la acción (`tasks.importTasks`): registro, historial, deshacer y aviso a las demás pestañas, igual.
 */
export async function importTasks(projectId: string, text: string, opts: z.input<typeof importOptions> = {}) {
  // El texto no va al registro (puede ser largo); lo importado queda en el historial de cada tarea.
  return runAction({ name: "tasks.importTasks", args: [projectId, opts] }, async (): Promise<ImportTasksData> => {
    const user = await requireUser();
    const pid = v.id.parse(projectId);
    const [t, locale] = await Promise.all([getT(), getLocale()]);
    const raw = z.string().max(TASKS_TEXT_MAX_CHARS, t("El texto es demasiado largo para importarlo (máximo {mb} MB).", { mb: TASKS_TEXT_MAX_CHARS / 1_000_000 })).parse(text);
    const o = importOptions.parse(opts ?? {});
    await assertProjectAccess(user, pid);
    if (!rateLimit(`import-tasks:${user.id}`, 10, 60_000)) throw new AppError("Demasiadas importaciones seguidas. Espera un momento.");
    const read = parseTasksText(raw);
    if (read.tooMany) throw new AppError(t("Hay {n} tareas y se importan como mucho {max} de una vez.", { n: read.total, max: TASKS_JSON_MAX }));
    const r = new TaskJsonResolver(user, pid, t, locale);
    const [columns, kinds] = await Promise.all([r.columns(), r.kinds()]);
    if (!columns.length || !kinds.length) throw new AppError("La columna no existe.");
    const forced = o.columnId ? columns.find((c) => c.id === o.columnId) : undefined;
    if (o.columnId && !forced) throw new AppError("La columna no existe.");

    const failed: ImportNotice[] = read.failed.map((f) => ({ n: f.n, title: null, text: t(TASK_READ_FAILURE[f.reason]) }));
    const items: ImportItem[] = [];
    for (const one of read.tasks) {
      const checked = checkPastedTask(one.task, t);
      const title = checked.ok ? v.taskTitle.safeParse(checked.data.title ?? "") : null;
      if (!checked.ok || !title?.success) {
        failed.push({ n: one.n, title: one.task.title ?? null, text: checked.ok ? t("no tiene título") : checked.error });
        continue;
      }
      const json = checked.data;
      const skipped: string[] = one.problems.map((f) => t(PASTE_FIELD_NAME[f]));
      const skip = (what: string) => {
        if (!skipped.includes(what)) skipped.push(what);
      };
      const fields = await r.fields({ ...json, title: undefined }, skip, null);
      let columnId = forced?.id;
      if (!columnId && json.column !== undefined) {
        columnId = await r.columnId(json.column);
        if (!columnId) skip(t("columna «{name}» (no existe)", { name: quoteName(json.column) }));
      }
      let docs = json.googleDocs ? pastedDocs(json.googleDocs) : [];
      if (docs.length > MAX_TASK_DOCS) {
        docs = docs.slice(0, MAX_TASK_DOCS);
        skip(t("documentos de Google (máximo {max} por tarea)", { max: MAX_TASK_DOCS }));
      }
      items.push({
        n: one.n,
        title: title.data,
        fields,
        columnId: columnId ?? columns[0]!.id,
        kindId: fields.kindId ?? kinds[0]!.id,
        labelNames: json.labels ? r.labelNames(json.labels, skip) : [],
        subtasks: json.subtasks ? r.subtasks(json.subtasks, skip) : [],
        docs,
        json,
        skipped,
      });
    }
    if (!items.length) {
      throw new AppError(failed.length ? t("No se ha podido leer ninguna tarea: {reason}.", { reason: failed[0]!.text }) : t("No hay ninguna tarea que importar."));
    }
    if (!rateLimit(`import-tasks-n:${user.id}`, TASKS_JSON_MAX * 4, 10 * 60_000, items.length)) throw new AppError("Demasiadas tareas importadas seguidas. Espera unos minutos.");

    // Dependencias: primero dentro del lote (por el id de origen o por el título), después en el proyecto.
    const byInfoId = new Map<string, number>();
    const byTitle = new Map<string, number[]>();
    items.forEach((it, i) => {
      if (it.json.info?.id && !byInfoId.has(it.json.info.id)) byInfoId.set(it.json.info.id, i);
      const key = foldName(mentionsToPlain(it.title));
      (byTitle.get(key) ?? byTitle.set(key, []).get(key)!).push(i);
    });
    const inBatch: (number | null)[] = items.map(() => null);
    const outside: { i: number; id?: string; title?: string }[] = [];
    const depName = (d: { id?: string; title?: string }) => quoteName(d.title ?? d.id ?? "");
    items.forEach((it, i) => {
      const dep = it.json.dependsOn;
      if (!dep) return;
      const viaId = dep.id !== undefined ? byInfoId.get(dep.id) : undefined;
      const viaTitle = dep.title ? (byTitle.get(foldName(dep.title)) ?? []).filter((x) => x !== i) : [];
      if (viaId !== undefined && viaId !== i) inBatch[i] = viaId;
      else if (viaId === undefined && viaTitle.length === 1) inBatch[i] = viaTitle[0]!;
      else if (fromOtherProject(it.json, pid)) return; // de otro proyecto: se ignora sin avisar
      else if (viaTitle.length > 1) it.skipped.push(t("dependencia «{name}»", { name: depName(dep) }));
      else outside.push({ i, ...dep });
    });
    // Sin círculos dentro del lote: se aceptan en orden y la que cerraría uno con las ya aceptadas se descarta (y se avisa).
    const kept: (number | null)[] = items.map(() => null);
    for (let i = 0; i < items.length; i++) {
      const target = inBatch[i];
      if (target === null || target === undefined) continue;
      let cur: number | null = target;
      while (cur !== null && cur !== i) cur = kept[cur]!;
      if (cur === i) items[i]!.skipped.push(t("dependencia «{name}»", { name: depName(items[i]!.json.dependsOn!) }));
      else kept[i] = target;
    }
    inBatch.splice(0, inBatch.length, ...kept);
    const external: (string | null)[] = items.map(() => null);
    if (outside.length) {
      const found = await r.blockers(outside.map(({ id, title }) => ({ id, title })));
      outside.forEach((o, k) => {
        if (found[k]) external[o.i] = found[k]!;
        else items[o.i]!.skipped.push(t("dependencia «{name}»", { name: depName(o) }));
      });
    }

    // Etiquetas de todo el lote, de una vez (las que no existen se crean si caben). El aviso de la que no se puede crear va
    // a cada tarea que la pedía (índice nombre plegado → tareas) y, por tarea, solo unos pocos.
    const byLabel = new Map<string, number[]>();
    items.forEach((it, i) => {
      for (const key of new Set(it.labelNames.map(foldName))) (byLabel.get(key) ?? byLabel.set(key, []).get(key)!).push(i);
    });
    const labelFails = items.map(() => 0);
    const { ids: labelIds, created: createdLabels } = await r.ensureLabels(
      items.flatMap((it) => it.labelNames),
      (name) => (what) => {
        for (const i of byLabel.get(foldName(name)) ?? []) if (++labelFails[i]! <= LABEL_NOTICES_PER_TASK) items[i]!.skipped.push(what);
      },
    );
    labelFails.forEach((n, i) => {
      if (n > LABEL_NOTICES_PER_TASK) items[i]!.skipped.push(t("{n} etiquetas más (no se han podido crear)", { n: n - LABEL_NOTICES_PER_TASK }));
    });

    const today = todayIso(appTimeZone());
    let ids: string[];
    try {
      ids = await db.$transaction(async (tx) => {
        // Todo o nada: si el lote no cabe en el proyecto o en una columna con tope, no se crea ninguna.
        await assertTaskCapacity(tx, pid, items.length);
        const perColumn = new Map<string, number>();
        for (const it of items) perColumn.set(it.columnId, (perColumn.get(it.columnId) ?? 0) + 1);
        await lockColumns(tx, [...perColumn.keys()]);
        const last = new Map<string, number | null>();
        for (const [columnId, n] of perColumn) {
          await assertColumnRoom(tx, columnId, n);
          last.set(columnId, await lastPositionIn(tx, columnId));
        }
        const created = await tx.task.createManyAndReturn({
          data: items.map((it) => {
            const position = positionBetween(last.get(it.columnId) ?? null, null);
            last.set(it.columnId, position);
            const f = it.fields;
            const dueDate = f.dueDate ?? null;
            return {
              projectId: pid,
              columnId: it.columnId,
              title: it.title,
              kindId: it.kindId,
              description: f.description ?? "",
              assigneeId: f.assigneeId ?? null,
              color: f.color ?? null,
              linkUrl: f.linkUrl ?? null,
              dueDate: dueDate ? isoToDate(dueDate) : null,
              deliverableId: f.deliverableId ?? null,
              ...normalizeRecurrence(f.recurrence ?? "NONE", f.recurrenceDay ?? null, dueDate, today),
              ...fieldData(pickTaskFields(f as z.infer<typeof taskFieldSchema>)),
              position,
              createdById: user.id,
            };
          }),
          select: { id: true },
        });
        // `createManyAndReturn` conserva el orden de entrada: la tarea i es la i del lote.
        const newIds = created.map((c) => c.id);
        const taskLabels = items.flatMap((it, i) => [...new Set(it.labelNames.flatMap((n) => labelIds.get(foldName(n)) ?? []))].map((labelId) => ({ taskId: newIds[i]!, labelId })));
        if (taskLabels.length) await tx.taskLabel.createMany({ data: taskLabels });
        const subtasks = items.flatMap((it, i) => it.subtasks.map((s, j) => ({ taskId: newIds[i]!, title: s.title, done: s.done, position: (j + 1) * POSITION_STEP })));
        if (subtasks.length) await tx.subtask.createMany({ data: subtasks });
        const links = items.flatMap((it, i) => it.docs.map((d) => ({ taskId: newIds[i]!, kind: d.kind, title: d.title, url: d.url, createdById: user.id })));
        if (links.length) await tx.taskLink.createMany({ data: links });
        const blocked = items.flatMap((_, i) => {
          const to = inBatch[i] !== null && inBatch[i] !== undefined ? newIds[inBatch[i]!]! : external[i];
          return to ? [{ id: newIds[i]!, by: to }] : [];
        });
        if (blocked.length) {
          // Las nuevas no bloquean a ninguna existente: los círculos solo pueden estar dentro del lote (ya descartados).
          // La que bloquea debe seguir en el proyecto (bajo el candado de bloqueos, como al editar).
          await lockBlocking(tx, pid);
          await tx.$executeRaw`
            UPDATE "Task" AS t SET "blockedById" = v."by"
            FROM unnest(${blocked.map((b) => b.id)}::text[], ${blocked.map((b) => b.by)}::text[]) AS v("id", "by")
            WHERE t."id" = v."id" AND EXISTS (SELECT 1 FROM "Task" AS x WHERE x."id" = v."by" AND x."projectId" = ${pid})`;
        }
        return newIds;
      });
    } catch (err) {
      // Las etiquetas recién creadas no se quedan sin uso si la importación no llega a hacerse.
      if (createdLabels.length) await db.label.deleteMany({ where: { id: { in: createdLabels }, projectId: pid, tasks: { none: {} } } }).catch(() => undefined);
      throw err;
    }
    // Deshacer (de la última a la primera): se borran las tareas y después las etiquetas que creó, si nadie más las usa.
    addUndo(...createdLabels.map((id) => ({ t: "label.remove" as const, id })), ...ids.map((id) => ({ t: "task.remove" as const, id })));
    for (const id of ids) recordTaskEvent(id, "create", { k: "Importó la tarea desde JSON" });
    if (createdLabels.length) needOwnRefresh();
    const notices: ImportNotice[] = items.flatMap((it) => it.skipped.map((text) => ({ n: it.n, title: it.title, text })));
    describeAction("Importó {count} desde JSON", { count: tasksN(ids.length) }, { taskIds: ids, notices: notices.length, failed: failed.length, labels: createdLabels.length });
    // Un aviso por responsable (no uno por tarea), como al crear varias.
    const byAssignee = new Map<string, number[]>();
    items.forEach((it, i) => {
      const a = it.fields.assigneeId;
      if (a && a !== user.id) (byAssignee.get(a) ?? byAssignee.set(a, []).get(a)!).push(i);
    });
    for (const [assigneeId, list] of byAssignee) {
      await notifyTask({ type: "ASSIGNED", actorId: user.id, taskId: ids[list[0]!]!, projectId: pid, recipientIds: [assigneeId], excerpt: list.length === 1 ? makeExcerpt(items[list[0]!]!.title) : assignedBatchExcerpt(list.length) });
    }
    return { tasks: await loadBoardTasksByIds(ids), notices, failed: failed.sort((a, b) => a.n - b.n) };
  });
}
