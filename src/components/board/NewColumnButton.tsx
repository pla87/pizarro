"use client";

import { Plus } from "lucide-react";
import { useState } from "react";
import { createColumn } from "@/actions/columns";
import { useToast } from "../ui/Toast";
import { useBoard } from "./context";

export function NewColumnButton() {
  const { project, setColumns, track } = useBoard();
  const toast = useToast();
  const [editing, setEditing] = useState(false);
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
    setEditing(false);
  };

  if (!editing) {
    return (
      <button
        onClick={() => setEditing(true)}
        className="flex h-11 w-72 shrink-0 items-center gap-2 rounded-xl border-2 border-dashed border-slate-300 px-3 text-sm font-medium text-slate-500 hover:border-brand-500 hover:text-brand-600 max-md:hidden dark:border-slate-700"
      >
        <Plus size={16} /> Añadir columna
      </button>
    );
  }
  return (
    <form onSubmit={submit} className="w-72 shrink-0 space-y-2 rounded-xl bg-slate-100 p-2 max-md:hidden dark:bg-slate-900/60">
      <input
        className="input"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Nombre de la columna"
        maxLength={80}
        autoFocus
        onKeyDown={(e) => e.key === "Escape" && setEditing(false)}
      />
      <div className="flex gap-2">
        <button className="btn-primary py-1.5" disabled={busy || !name.trim()}>Añadir</button>
        <button type="button" className="btn-ghost py-1.5" onClick={() => setEditing(false)}>Cancelar</button>
      </div>
    </form>
  );
}
