"use client";

import { useId, useState } from "react";
import { AlertTriangle, FileDown } from "lucide-react";
import { setColumnAssignee } from "@/actions/columns";
import { isAssignColumn, MAX_ASSIGN_DUE_DAYS, parseAssignDays } from "@/lib/column-assign-core";
import type { BoardColumn } from "@/lib/types";
import { useT } from "@/i18n/client";
import { Avatar } from "../ui/Avatar";
import { cn } from "../ui/cn";
import { useConfirm } from "../ui/ConfirmDialog";
import { Modal } from "../ui/Modal";
import { useToast } from "../ui/Toast";
import { ColumnActionButton } from "./ColumnActionButton";
import { downloadFile, useDownloadBusy } from "./columnDownload";
import { useBoard } from "./context";

// Columna «Asignación a persona» (reglas en lib/column-assign-core.ts): la persona y el plazo en la cabecera, el diálogo
// para elegirlos y el botón «Descargar plan (PDF)» (bajo la cabecera). La columna tiene rol NONE: la marcan su persona y su plazo.

/**
 * Cabecera: la persona (avatar y nombre) y el plazo, si lo hay; pulsando se cambian. Si la columna no tiene persona (venía
 * de una plantilla) o la persona ya no puede tener tareas del proyecto, un aviso en ámbar: la columna no asigna.
 */
export function AssignHeader({ column, onEdit }: { column: BoardColumn; onEdit: () => void }) {
  const t = useT();
  const { users } = useBoard();
  const person = column.assigneeId ? users.find((u) => u.id === column.assigneeId) : undefined;
  if (!person) {
    const why = column.assigneeId
      ? t("La persona de esta columna ya no tiene acceso al proyecto: la columna no asigna. Elige otra.")
      : t("Esta columna aún no tiene persona: no asigna. Elige a quién.");
    return (
      <div className="px-2 pb-1.5">
        <button type="button" onClick={onEdit} data-assign-warning className="flex w-full items-center gap-1.5 rounded-md bg-amber-100 px-2 py-1 text-left text-xs font-medium text-amber-900 hover:bg-amber-200 dark:bg-amber-500/15 dark:text-amber-200 dark:hover:bg-amber-500/25" title={why}>
          <AlertTriangle size={13} className="shrink-0" aria-hidden />
          <span className="min-w-0">{why}</span>
        </button>
      </div>
    );
  }
  const due = column.assignDueDays;
  return (
    <div className="px-2 pb-1.5">
      <button
        type="button"
        onClick={onEdit}
        data-assign-person
        className="flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left text-xs hover:bg-slate-200/70 dark:hover:bg-slate-800"
        title={t("Cambiar la persona o el plazo de la columna")}
      >
        <Avatar id={person.id} name={person.name} />
        <span className="min-w-0 flex-1 truncate font-medium">{person.name}</span>
        {due != null && <span className="shrink-0 text-slate-600 dark:text-slate-400">{due === 1 ? t("Vence en 1 día") : t("Vence en {n} días", { n: due })}</span>}
      </button>
    </div>
  );
}

/**
 * «Descargar plan (PDF)»: el plan de la persona en esta columna. Se descarga sin salir del tablero (columnDownload.ts):
 * mientras se genera, el botón está ocupado y otro clic (aquí o en el menú) no pide otro. `reason`: por qué no se puede
 * (sin persona o sin tarjetas), o null.
 */
export function useAssignPlan(column: BoardColumn, cardCount: number): { reason: string | null; busy: boolean; run: () => void } {
  const t = useT();
  const toast = useToast();
  const { users, project } = useBoard();
  const key = `plan:${column.id}`;
  const busy = useDownloadBusy(key);
  const person = column.assigneeId ? users.find((u) => u.id === column.assigneeId) : undefined;
  const reason = !person
    ? t("Elige antes la persona de la columna")
    : cardCount === 0 ? t("No hay tarjetas en «{name}»", { name: column.name }) : null;
  const run = () => void downloadFile(key, `/api/projects/${project.id}/columns/${column.id}/plan`, {
    fallbackName: "plan.pdf",
    failed: t("No se pudo generar el plan."),
    offline: t("Sin conexión: no se ha podido generar el plan."),
    done: t("Plan de {name} descargado", { name: person?.name ?? "" }),
  }, t, toast);
  return { reason, busy, run };
}

/**
 * Botón «Descargar plan (PDF)» (antes «Generar plan»: no decía que descarga un PDF, como «Publicar programa (PDF)»), bajo
 * la cabecera como los de las demás columnas especiales. Apagado sin tarjetas o sin persona, con el motivo a la vista.
 */
export function AssignPlanButton({ column, cardCount }: { column: BoardColumn; cardCount: number }) {
  const t = useT();
  const { reason, busy, run } = useAssignPlan(column, cardCount);
  return (
    <ColumnActionButton
      icon={FileDown}
      label={busy ? t("Generando PDF…") : t("Descargar plan (PDF)")}
      onClick={run}
      disabled={reason != null}
      busy={busy}
      title={reason ?? t("PDF con las tareas de la persona en esta columna, por vencimiento")}
    />
  );
}

/** Hasta cuántas personas la lista se considera corta (el diálogo ofrece añadir más al proyecto). */
const SHORT_LIST = 3;

/**
 * Elegir la persona (las que pueden tener tareas del proyecto, como el selector de «Responsable») y, opcional, «Vence en
 * N días». Al cambiar de persona, todas las tarjetas de la columna pasan a ella: se pide confirmación con cuántas cambian.
 * Cambiar solo el plazo no toca las tarjetas que ya están (es para las que entren): ni confirmación.
 */
export function AssignDialog({ column, onClose }: { column: BoardColumn; onClose: () => void }) {
  const t = useT();
  const toast = useToast();
  const confirm = useConfirm();
  const { users, currentUserId, getTasks, track, refresh, project, canManageMembers } = useBoard();
  const id = useId();
  // Con otro rol, la persona y el plazo que pueda conservar (de una versión anterior) no cuentan: se empieza de cero.
  const current = isAssignColumn(column) ? { assigneeId: column.assigneeId, dueDays: column.assignDueDays } : { assigneeId: null, dueDays: null };
  const valid = users.some((u) => u.id === current.assigneeId);
  const [personId, setPersonId] = useState(valid ? current.assigneeId! : "");
  const [days, setDays] = useState(current.dueDays != null ? String(current.dueDays) : "");
  const [error, setError] = useState<string | null>(null);
  // Proponer el nombre de la persona como nombre de la columna: marcado si la columna sigue con un nombre genérico
  // («Persona 1», el de otra persona del proyecto); si no, se ofrece sin marcar (nunca se pisa un nombre elegido sin preguntar).
  const picked = users.find((u) => u.id === personId);
  // Con la persona que ya tenía y un nombre elegido, no se vuelve a ofrecer cada vez que se abre el diálogo.
  const generic = genericColumnName(column.name, users);
  const offerRename = !!picked && picked.name.trim() !== column.name.trim() && (generic || personId !== current.assigneeId);
  const [renameTo, setRenameTo] = useState<Record<string, boolean>>({});
  const rename = offerRename && (renameTo[personId] ?? generic);

  const save = async () => {
    const dueDays = parseAssignDays(days);
    if (!personId) return setError(t("Elige una persona."));
    if (dueDays === undefined) return setError(t("Indica un número entero de días entre 1 y {max}, o déjalo vacío.", { max: MAX_ASSIGN_DUE_DAYS }));
    onClose();
    if (personId === current.assigneeId && dueDays === current.dueDays && !rename) return;
    const person = users.find((u) => u.id === personId)!;
    // Las que cambian de manos (las de la persona elegida se quedan como están). Con la misma persona, ninguna.
    const changing = personId === current.assigneeId ? 0 : getTasks().filter((x) => x.columnId === column.id && x.assigneeId !== personId).length;
    if (changing > 0 && !(await confirm({
      title: t("Asignación a persona"),
      message: changing === 1
        ? t("1 tarjeta de «{col}» pasará a {name}.", { col: column.name, name: person.name })
        : t("Las {n} tarjetas de «{col}» que no son de {name} pasarán a esa persona.", { n: changing, col: column.name, name: person.name }),
      confirmLabel: t("Asignar"),
    }))) return;
    const res = await track(setColumnAssignee(column.id, { assigneeId: personId, dueDays, ...(rename ? { rename: true } : {}) }));
    if (!res.ok) return toast(res.error, "error");
    refresh();
    if (res.data.reassigned) toast(res.data.reassigned === 1 ? t("1 tarea asignada a {name}", { name: person.name }) : t("{n} tareas asignadas a {name}", { n: res.data.reassigned, name: person.name }));
  };

  return (
    <Modal
      open
      onClose={onClose}
      size="sm"
      title={t("Asignación a persona")}
      footer={
        <>
          <button className="btn-secondary" onClick={onClose}>{t("Cancelar")}</button>
          <button className="btn-primary" onClick={save}>{t("Guardar")}</button>
        </>
      }
    >
      <p className="mb-3 text-sm text-slate-600 dark:text-slate-400">{t("Todo lo que entre en esta columna se asignará a esta persona.")}</p>
      <label className="label" htmlFor={`${id}-person`}>{t("Persona")}</label>
      <select id={`${id}-person`} className="input w-full" value={personId} onChange={(e) => { setPersonId(e.target.value); setError(null); }}>
        {!personId && <option value="">{t("Elige una persona")}</option>}
        {users.map((u) => <option key={u.id} value={u.id}>{u.id === currentUserId ? t("{name} (yo)", { name: u.name }) : u.name}</option>)}
      </select>
      {/* Con pocas personas, quizá falta la que se busca: quien puede, la añade al proyecto (Ajustes → General). */}
      {/* En otra pestaña: aquí no se pierde lo elegido, y al volver la lista ya trae a las personas nuevas (el tablero se
          refresca al volver a la ventana). */}
      {canManageMembers && users.length <= SHORT_LIST && <AddPeopleLink projectId={project.id} className="mt-1" />}
      {offerRename && (
        <label className="mt-2 flex items-start gap-2 text-sm">
          <input type="checkbox" className="mt-0.5" checked={rename} onChange={(e) => setRenameTo((m) => ({ ...m, [personId]: e.target.checked }))} data-assign-rename />
          <span>{t("Cambiar el nombre de la columna a «{name}»", { name: picked.name })}</span>
        </label>
      )}
      <label className="label mt-3" htmlFor={`${id}-days`}>{t("Vence en (días, opcional)")}</label>
      <input
        id={`${id}-days`}
        className="input w-full"
        type="number"
        inputMode="numeric"
        min={1}
        max={MAX_ASSIGN_DUE_DAYS}
        placeholder={t("Sin plazo")}
        value={days}
        onChange={(e) => { setDays(e.target.value); setError(null); }}
        // Sin preventDefault, el Intro llega (keypress) al botón que recibe el foco al cerrar (la cabecera o «Opciones de
        // columna») y lo vuelve a pulsar: el diálogo se abría otra vez con el plazo anterior.
        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void save(); } }}
        aria-describedby={`${id}-help`}
      />
      <p id={`${id}-help`} className="mt-1 text-xs text-slate-600 dark:text-slate-400">{t("Las tarjetas que entren sin fecha límite vencerán ese número de días después. Las que ya tienen fecha la conservan.")}</p>
      {error && <p role="alert" className="mt-2 text-sm text-red-600 dark:text-red-400">{error}</p>}
    </Modal>
  );
}

/**
 * ¿El nombre de la columna es de los que no ha elegido nadie? «Persona 1», «Person 2» (los de ejemplo) o el de una persona del
 * proyecto (la columna era de otra). Entonces «Cambiar el nombre de la columna» sale marcado.
 */
function genericColumnName(name: string, users: readonly { name: string }[]): boolean {
  const n = name.trim().toLowerCase();
  return /^(persona|person)\s*\d*$/.test(n) || users.some((u) => u.name.trim().toLowerCase() === n);
}

/**
 * «Añadir personas al proyecto» (Ajustes → General → Miembros), en otra pestaña: lo que se estaba configurando en el tablero
 * no se pierde. Al volver a esta, el tablero se refresca y trae a las personas nuevas.
 */
export function AddPeopleLink({ projectId, className }: { projectId: string; className?: string }) {
  const t = useT();
  return (
    <p className={cn("text-xs", className)}>
      <a className="text-brand-600 underline dark:text-brand-300" href={`/p/${projectId}/settings?tab=general#members`} target="_blank" rel="noopener" data-assign-add-people>
        {t("Añadir personas al proyecto")}
      </a>
      <span className="text-slate-500 dark:text-slate-400"> {t("(se abre en otra pestaña)")}</span>
    </p>
  );
}
