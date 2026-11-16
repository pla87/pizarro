"use server";

// Exportar varias tareas como JSON («pizarro.tasks», ver lib/task-json.ts): «Exportar (N)» de la cabecera del tablero.
// Importarlas no es una acción (las acciones admiten como mucho 1 MB): es la ruta POST /api/projects/[projectId]/import-tasks,
// con la lógica en lib/task-import.ts. Pegar una tarea sobre otra (pasteTaskJson) y copiarla (getTaskJson) están en
// tasks.ts; las reglas para pasar nombres a ids, en lib/task-json-resolve.ts (las mismas para pegar e importar).
import { z } from "zod";
import { db } from "@/lib/db";
import { runAction } from "@/lib/action";
import { assertProjectAccess } from "@/lib/access";
import { appTimeZone } from "@/lib/board";
import { describeAction } from "@/lib/action-context";
import { tasksN } from "@/lib/undo-label";
import { AppError } from "@/lib/errors";
import { TASK_ORDER } from "@/lib/task-positions";
import { requireUser } from "@/lib/session";
import * as v from "@/lib/validation";
import { todayIso } from "@/lib/dates";
import { getLocale, getT } from "@/i18n/server";
import { buildTasksJson, TASKS_JSON_MAX, TASKS_TEXT_MAX_CHARS, tasksExportFileName } from "@/lib/task-json";
import { taskJsonObjects } from "@/lib/task-json-resolve";

/**
 * Las tareas elegidas (con la casilla de las tarjetas) como un JSON «pizarro.tasks», en el orden del tablero, y el nombre
 * del fichero para descargarlo. Solo tareas del proyecto y visibles para quien exporta (las demás se ignoran); como mucho
 * TASKS_JSON_MAX. Lo que se exporta se puede volver a importar (aquí o en otra instalación): el texto no pasa del tope de
 * la importación (TASKS_TEXT_MAX_CHARS). Va sangrado, para leerlo (personas e IA); si así no cabe, sin sangrar; y si ni
 * así, no se exporta (con un aviso para elegir menos tareas).
 */
export async function exportTasksJson(projectId: string, taskIds: string[]) {
  return runAction({ name: "tasks.exportTasksJson", args: [projectId, { tasks: Array.isArray(taskIds) ? taskIds.length : 0 }] }, async (): Promise<{ text: string; fileName: string; count: number }> => {
    const user = await requireUser();
    const pid = v.id.parse(projectId);
    const t = await getT();
    const ids = z.array(v.id).min(1, "No hay tareas que exportar.").max(TASKS_JSON_MAX, t("Se exportan como mucho {max} tareas de una vez.", { max: TASKS_JSON_MAX })).parse(taskIds);
    await assertProjectAccess(user, pid);
    const [project, locale] = await Promise.all([db.project.findUniqueOrThrow({ where: { id: pid }, select: { id: true, name: true } }), getLocale()]);
    const rows = await taskJsonObjects({ id: { in: [...new Set(ids)] }, projectId: pid }, locale, [{ column: { position: "asc" } }, ...TASK_ORDER]);
    if (!rows.length) throw new AppError("No hay tareas que exportar.");
    const data = buildTasksJson(project, rows.map((r) => r.json), new Date().toISOString());
    let text = JSON.stringify(data, null, 2);
    if (text.length > TASKS_TEXT_MAX_CHARS) text = JSON.stringify(data);
    if (text.length > TASKS_TEXT_MAX_CHARS) {
      throw new AppError(t("Las tareas elegidas ocupan más de {mb} MB y no se podrían volver a importar: exporta menos de una vez.", { mb: TASKS_TEXT_MAX_CHARS / 1_000_000 }));
    }
    describeAction("Exportó {count} como JSON", { count: tasksN(rows.length) }, { taskIds: rows.map((r) => r.id) });
    return { text, fileName: tasksExportFileName(t("tareas"), project.name, todayIso(appTimeZone())), count: rows.length };
  });
}
