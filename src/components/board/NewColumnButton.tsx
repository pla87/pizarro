"use client";

import { Plus } from "lucide-react";
import { useState } from "react";
import { createColumn } from "@/actions/columns";
import { useT } from "@/i18n/client";
import { cn } from "../ui/cn";
import { Modal } from "../ui/Modal";
import { useToast } from "../ui/Toast";
import { useBoard } from "./context";

/**
 * Añadir columna. En escritorio: barra vertical estrecha al final del tablero.
 * En móvil: botón redondo al final de las pestañas de columnas.
 */
export function NewColumnButton({ variant, onCreated }: { variant: "desktop" | "mobile"; onCreated?: (columnId: string) => void }) {
  const { project, setColumns, track } = useBoard();
  const toast = useToast();
  const t = useT();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    const res = await track(createColumn(project.id, name));
    setBusy(false);
    if (!res.ok) return toast(res.error, "error");
    setColumns((cols) => [...cols, res.data]);
    setName("");
    setOpen(false);
    onCreated?.(res.data.id);
  };

  return (
    <>
      {variant === "desktop" ? (
        <button
          onClick={() => setOpen(true)}
          className="group flex w-10 shrink-0 items-start justify-center rounded-xl border-2 border-dashed border-slate-300 pt-2 hover:border-brand-500 max-md:hidden dark:border-slate-700"
          aria-label={t("Añadir columna")}
          title={t("Añadir columna")}
        >
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-slate-200 text-slate-600 group-hover:bg-brand-600 group-hover:text-on-brand dark:bg-slate-800 dark:text-slate-300">
            <Plus size={16} />
          </span>
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
      <Modal open={open} onClose={() => setOpen(false)} title={t("Nueva columna")} size="sm">
        <form onSubmit={submit} className="space-y-4">
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder={t("Nombre de la columna")} maxLength={80} data-autofocus />
          <div className="flex justify-end gap-2">
            <button type="button" className="btn-secondary" onClick={() => setOpen(false)}>{t("Cancelar")}</button>
            <button className="btn-primary" disabled={busy || !name.trim()}>{t("Añadir")}</button>
          </div>
        </form>
      </Modal>
    </>
  );
}
