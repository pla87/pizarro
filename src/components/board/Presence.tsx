"use client";

import { useEffect, useState } from "react";
import { Avatar } from "../ui/Avatar";

const POLL_MS = 20_000;
const MAX_SHOWN = 5;

/** Círculos con las iniciales de quien ha hecho algo en este tablero en los últimos 5 minutos. */
export function Presence({ projectId }: { projectId: string }) {
  const [users, setUsers] = useState<{ id: string; name: string }[]>([]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (document.visibilityState !== "visible") return;
      try {
        const res = await fetch(`/api/projects/${projectId}/presence`, { cache: "no-store" });
        if (res.ok && !cancelled) setUsers(((await res.json()) as { users: { id: string; name: string }[] }).users);
      } catch {
        // Sin conexión: se mantiene lo último conocido.
      }
    };
    void load();
    const timer = setInterval(load, POLL_MS);
    window.addEventListener("focus", load);
    return () => {
      cancelled = true;
      clearInterval(timer);
      window.removeEventListener("focus", load);
    };
  }, [projectId]);

  if (users.length === 0) return null;
  const extra = users.length - MAX_SHOWN;
  const names = users.map((u) => u.name).join(", ");
  return (
    <div className="flex items-center -space-x-1.5" title={`Activos en los últimos 5 minutos: ${names}`} aria-label={`Activos en los últimos 5 minutos: ${names}`}>
      {users.slice(0, MAX_SHOWN).map((u) => (
        <span key={u.id} className="rounded-full ring-2 ring-slate-50 dark:ring-slate-950">
          <Avatar id={u.id} name={u.name} size="md" />
        </span>
      ))}
      {extra > 0 && (
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-200 text-xs font-semibold text-slate-600 ring-2 ring-slate-50 dark:bg-slate-700 dark:text-slate-200 dark:ring-slate-950">+{extra}</span>
      )}
    </div>
  );
}
