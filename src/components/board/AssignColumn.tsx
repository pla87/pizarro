"use client";

import { useId, useState } from "react";
import { AlertTriangle, FileDown } from "lucide-react";
import { setColumnAssignee } from "@/actions/columns";
import { MAX_ASSIGN_DUE_DAYS, parseAssignDays } from "@/lib/column-assign-core";
import type { BoardColumn } from "@/lib/types";
import { useT } from "@/i18n/client";
import { Avatar } from "../ui/Avatar";
import { useConfirm } from "../ui/ConfirmDialog";
import { Modal } from "../ui/Modal";
import { useToast } from "../ui/Toast";
import { useBoard } from "./context";

// Columna «Asignación a persona» (reglas en lib/column-assign-core.ts): la persona y el plazo en la cabecera, el diálogo
// para elegirlos y el botón «Generar plan» del pie. La columna tiene rol NONE: la marcan su persona y su plazo.

/** «Generar plan»: el PDF con el plan de la persona en esta columna (se abre en otra pestaña, como los demás PDF de columna). */
export const assignPlanPdf = (projectId: string, columnId: string) => window.open(`/api/projects/${projectId}/columns/${columnId}/plan`, "_blank", "noopener");

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

/** Pie: «Generar plan» (PDF del plan de la persona en esta columna). Apagado sin tarjetas o sin persona, con el motivo. */
export function AssignPlanButton({ column, cardCount }: { column: BoardColumn; cardCount: number }) {
  const t = useT();
  const toast = useToast();
  const { users, project } = useBoard();
  const reason = !column.assigneeId || !users.some((u) => u.id === column.assigneeId)
    ? t("Elige antes la persona de la columna")
    : cardCount === 0 ? t("No hay tarjetas en esta columna") : null;
  return (
    <div className="px-2 pt-1 pb-2 max-md:pr-16" data-assign-plan>
      <button
        type="button"
        className="btn-secondary w-full py-1.5 aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
        onClick={reason ? () => toast(reason, "error") : () => assignPlanPdf(project.id, column.id)}
        aria-disabled={reason ? true : undefined}
        title={reason ?? t("PDF con las tareas de la persona en esta columna, por vencimiento")}
      >
        <FileDown size={15} /> {t("Generar plan")}
      </button>
    </div>
  );
}

/**
 * Elegir la persona (las que pueden tener tareas del proyecto, como el selector de «Responsable») y, opcional, «Vence en
 * N días». Al cambiar de persona, todas las tarjetas de la columna pasan a ella: se pide confirmación con cuántas cambian.
 */
export function AssignDialog({ column, onClose }: { column: BoardColumn; onClose: () => void }) {
  const t = useT();
  const toast = useToast();
  const confirm = useConfirm();
  const { users, currentUserId, getTasks, track, refresh } = useBoard();
  const id = useId();
  const valid = users.some((u) => u.id === column.assigneeId);
  const [personId, setPersonId] = useState(valid ? column.assigneeId! : "");
  const [days, setDays] = useState(column.assignDueDays != null ? String(column.assignDueDays) : "");
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    const dueDays = parseAssignDays(days);
    if (!personId) return setError(t("Elige una persona."));
    if (dueDays === undefined) return setError(t("Indica un número entero de días entre 1 y {max}, o déjalo vacío.", { max: MAX_ASSIGN_DUE_DAYS }));
    onClose();
    if (personId === column.assigneeId && dueDays === column.assignDueDays) return;
    const person = users.find((u) => u.id === personId)!;
    // Las que cambian de manos (las de la persona elegida se quedan como están).
    const changing = getTasks().filter((x) => x.columnId === column.id && x.assigneeId !== personId).length;
    if (changing > 0 && !(await confirm({
      title: t("Asignación a persona"),
      message: changing === 1
        ? t("1 tarjeta de «{col}» pasará a {name}.", { col: column.name, name: person.name })
        : t("Las {n} tarjetas de «{col}» que no son de {name} pasarán a esa persona.", { n: changing, col: column.name, name: person.name }),
      confirmLabel: t("Asignar"),
    }))) return;
    const res = await track(setColumnAssignee(column.id, { assigneeId: personId, dueDays }));
    if (!res.ok) return toast(res.error, "error");
    refresh();
    if (res.data.costEnabled) toast(t("Se ha activado el campo Coste"));
    else if (res.data.reassigned) toast(res.data.reassigned === 1 ? t("1 tarjeta asignada a {name}", { name: person.name }) : t("{n} tarjetas asignadas a {name}", { n: res.data.reassigned, name: person.name }));
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
        onKeyDown={(e) => { if (e.key === "Enter") void save(); }}
        aria-describedby={`${id}-help`}
      />
      <p id={`${id}-help`} className="mt-1 text-xs text-slate-600 dark:text-slate-400">{t("Las tarjetas que entren sin fecha límite vencerán ese número de días después. Las que ya tienen fecha la conservan.")}</p>
      {error && <p role="alert" className="mt-2 text-sm text-red-600 dark:text-red-400">{error}</p>}
    </Modal>
  );
}
