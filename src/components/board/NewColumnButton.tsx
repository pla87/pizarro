"use client";

import { Plus, Users } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createColumn, createPersonColumns } from "@/actions/columns";
import { useIntlLocale, useT } from "@/i18n/client";
import { PEOPLE_TEMPLATE, personColumnsNotice } from "@/lib/column-assign-core";
import { cn } from "../ui/cn";
import { Modal } from "../ui/Modal";
import { useToast } from "../ui/Toast";
import { afterModalHistory } from "../ui/useBackToClose";
import { AddPeopleLink } from "./AssignColumn";
import { useBoard } from "./context";

/** Lleva a la vista (escritorio: scroll lateral del tablero) la columna recién creada. */
function revealColumn(columnId: string): void {
  let frames = 0;
  const go = () => {
    const el = document.querySelector<HTMLElement>(`[data-column-id="${CSS.escape(columnId)}"]`);
    // Hasta que se pinte la columna (en el móvil está oculta: allí se cambia de pestaña, onCreated).
    if (!el || el.offsetParent === null) {
      if (++frames < 30) requestAnimationFrame(go);
      return;
    }
    const smooth = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollIntoView({ block: "nearest", inline: "nearest", behavior: smooth ? "smooth" : "auto" });
  };
  requestAnimationFrame(go);
}

/**
 * Añadir columna. En escritorio: una columna estrecha y discontinua al final del tablero, con el «+» y el texto en vertical.
 * En móvil: botón redondo al final de las pestañas de columnas. En proyectos de «Casa y familia», el diálogo ofrece además
 * «Organizar por personas».
 */
export function NewColumnButton({ variant, onCreated }: { variant: "desktop" | "mobile"; onCreated?: (columnId: string) => void }) {
  const { project, setColumns, track, users, canManageMembers, columns } = useBoard();
  const toast = useToast();
  const t = useT();
  const locale = useIntlLocale();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  // «Organizar por personas»: paso de confirmación dentro del mismo diálogo.
  const [byPeople, setByPeople] = useState(false);
  // Columna recién creada: se muestra cuando el diálogo ya se ha cerrado y ha retirado su entrada del historial (en el
  // móvil, cambiando de pestaña; en escritorio, con scroll hasta ella). Antes se hacía al momento: la vista saltaba a la
  // columna nueva y el «atrás» silencioso del diálogo al cerrarse se llevaba esa entrada, de modo que se volvía a la primera.
  const created = useRef<string | null>(null);
  const onCreatedRef = useRef(onCreated);
  useEffect(() => {
    onCreatedRef.current = onCreated;
  });
  useEffect(() => {
    const id = created.current;
    if (!id || open) return;
    created.current = null;
    afterModalHistory(() => {
      if (onCreatedRef.current) onCreatedRef.current(id);
      else revealColumn(id);
    });
  }, [open]);

  // Al cambiar de paso, el botón pulsado desaparece: el foco va a lo principal del paso nuevo (crear, o «Volver») o, al
  // volver, a «Organizar por personas»; sin esto caía en <body> y el lector de pantalla no anunciaba nada.
  const stepShown = useRef(false);
  useEffect(() => {
    if (!open) {
      stepShown.current = false;
      return;
    }
    if (!byPeople && !stepShown.current) return;
    stepShown.current = true;
    const target = byPeople
      ? document.querySelector<HTMLElement>("[data-people-columns] .btn-primary") ?? document.querySelector<HTMLElement>("[data-people-columns] .btn-secondary")
      : document.querySelector<HTMLElement>("[data-people-columns-open]");
    target?.focus();
  }, [byPeople, open]);

  const close = () => {
    setOpen(false);
    setByPeople(false);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    const res = await track(createColumn(project.id, name));
    setBusy(false);
    if (!res.ok) return toast(res.error, "error");
    setColumns((cols) => [...cols, res.data]);
    setName("");
    created.current = res.data.id;
    close();
  };

  // Personas del proyecto, las mismas que cuenta el servidor (createPersonColumns): en uno de equipo, sin los
  // administradores que no lo tienen en su lista (`peopleIds`). Las que ya tienen su columna no se repiten.
  const peopleTemplate = project.templateKey === PEOPLE_TEMPLATE;
  const peopleIds = project.peopleIds;
  const people = peopleIds ? users.filter((u) => peopleIds.includes(u.id)) : users;
  const adminsLeftOut = people.length < users.length;
  const missing = people.filter((u) => !columns.some((c) => c.assigneeId === u.id));
  const createForPeople = async () => {
    setBusy(true);
    const res = await track(createPersonColumns(project.id));
    setBusy(false);
    if (!res.ok) return toast(res.error, "error");
    close();
    const { created: added, moved } = res.data;
    if (!added.length) return toast(t("Todas las personas ya tienen su columna."));
    // Van antes de «Hecho» (el servidor corre las de detrás: `moved`); el tablero las ordena por posición.
    const shifted = new Map(moved.map((m) => [m.id, m.position]));
    setColumns((cols) => [
      ...cols.filter((c) => !added.some((n) => n.id === c.id)).map((c) => (shifted.has(c.id) ? { ...c, position: shifted.get(c.id)! } : c)),
      ...added,
    ]);
    created.current = added[0]!.id;
    toast(personColumnsNotice(added.map((c) => c.name), t, locale));
  };

  return (
    <>
      {variant === "desktop" ? (
        <button
          onClick={() => setOpen(true)}
          className="group flex w-10 shrink-0 flex-col items-center gap-2 rounded-xl border-2 border-dashed border-slate-300 pt-2 text-slate-600 hover:border-brand-500 hover:text-brand-700 max-md:hidden dark:border-slate-700 dark:text-slate-300 dark:hover:text-brand-300"
          aria-label={t("Añadir columna")}
          title={t("Añadir columna")}
        >
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-200 text-slate-600 group-hover:bg-brand-600 group-hover:text-on-brand dark:bg-slate-800 dark:text-slate-300">
            <Plus size={16} />
          </span>
          {/* El texto en vertical: se reconoce sin ocupar más ancho. */}
          <span aria-hidden className="text-xs font-medium whitespace-nowrap [writing-mode:vertical-rl]">{t("Añadir columna")}</span>
        </button>
      ) : (
        <button
          onClick={() => setOpen(true)}
          className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-full focus-visible:outline-offset-[-3px] bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300")}
          aria-label={t("Añadir columna")}
        >
          <Plus size={16} />
        </button>
      )}
      <Modal open={open} onClose={close} title={byPeople ? t("Organizar por personas") : t("Nueva columna")} size="sm">
        {byPeople ? (
          <div className="space-y-4" data-people-columns>
            {people.length <= 1 ? (
              <>
                <p className="text-sm text-slate-600 dark:text-slate-400">
                  {people.length === 0 ? t("Aún no hay nadie en el proyecto: añade antes a las personas.") : t("En el proyecto solo hay una persona: añade antes a las demás.")}
                </p>
                {canManageMembers && <AddPeopleLink projectId={project.id} />}
              </>
            ) : missing.length === 0 ? (
              <p className="text-sm text-slate-600 dark:text-slate-400">{t("Todas las personas ya tienen su columna.")}</p>
            ) : (
              <p className="text-sm text-slate-600 dark:text-slate-400">
                {missing.length === 1
                  ? t("Se creará una columna «Asignación a persona» para {names}: lo que entre en ella será de esa persona.", { names: missing[0]!.name })
                  : t("Se crearán {n} columnas «Asignación a persona», una por persona ({names}): lo que entre en cada una será de esa persona.", { n: missing.length, names: missing.map((u) => u.name).join(", ") })}
              </p>
            )}
            {/* Una tarjeta está en una sola columna: ponerla en la de una persona la saca de «Esta semana» o de donde esté. */}
            {people.length > 1 && missing.length > 0 && (
              <p className="text-sm text-slate-600 dark:text-slate-400">{t("Las tareas que pongas en estas columnas salen de su columna actual.")}</p>
            )}
            {/* Solo a quien puede hacer algo con ella (un administrador, que puede ponerse el proyecto en su lista) y mientras
                queden columnas por crear. En un proyecto de equipo (el único con administradores fuera, `peopleIds`),
                `canManageMembers` es lo mismo que ser administrador. */}
            {adminsLeftOut && canManageMembers && (people.length <= 1 || missing.length > 0) && (
              <p className="text-xs text-slate-500 dark:text-slate-400">{t("Los administradores cuentan solo si tienen el proyecto en «Proyectos en los que trabajo».")}</p>
            )}
            <div className="flex justify-end gap-2">
              <button type="button" className="btn-secondary" onClick={() => setByPeople(false)}>{t("Volver")}</button>
              {people.length > 1 && missing.length > 0 && (
                <button type="button" className="btn-primary" disabled={busy} onClick={createForPeople}>{missing.length === 1 ? t("Crear la columna") : t("Crear {n} columnas", { n: missing.length })}</button>
              )}
            </div>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-4">
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder={t("Nombre de la columna")} aria-label={t("Nombre de la columna")} maxLength={80} data-autofocus />
            {peopleTemplate && (
              <button type="button" className="flex items-center gap-1.5 text-left text-sm font-medium text-brand-700 hover:underline dark:text-brand-300" onClick={() => setByPeople(true)} data-people-columns-open>
                <Users size={15} aria-hidden className="shrink-0" /> {t("Organizar por personas: una columna para cada una")}
              </button>
            )}
            <div className="flex justify-end gap-2">
              <button type="button" className="btn-secondary" onClick={close}>{t("Cancelar")}</button>
              <button className="btn-primary" disabled={busy || !name.trim()}>{t("Añadir")}</button>
            </div>
          </form>
        )}
      </Modal>
    </>
  );
}
