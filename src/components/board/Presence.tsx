"use client";

import { useEffect, useState } from "react";
import { Avatar } from "../ui/Avatar";
import { cn } from "../ui/cn";

const POLL_MS = 20_000;
const MAX_SHOWN = 5;
const MAX_COMPACT = 3; // cabecera móvil: círculos pequeños y solo 3

/** Círculos con las iniciales de quien ha hecho algo en este tablero en los últimos 5 minutos. */
export function Presence({ projectId, compact }: { projectId: string; compact?: boolean }) {
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
  const max = compact ? MAX_COMPACT : MAX_SHOWN;
  const extra = users.length - max;
  const names = users.map((u) => u.name).join(", ");
  return (
    <div className="flex items-center -space-x-1.5" title={`Activos en los últimos 5 minutos: ${names}`} aria-label={`Activos en los últimos 5 minutos: ${names}`}>
      {users.slice(0, max).map((u) => (
        <span key={u.id} className={cn("rounded-full ring-2", compact ? "ring-white dark:ring-slate-900" : "ring-slate-50 dark:ring-slate-950")}>
          <Avatar id={u.id} name={u.name} size={compact ? "sm" : "md"} />
        </span>
      ))}
      {extra > 0 && (
        <span className={cn("flex items-center justify-center rounded-full bg-slate-200 font-semibold text-slate-600 ring-2 dark:bg-slate-700 dark:text-slate-200", compact ? "h-6 w-6 text-[10px] ring-white dark:ring-slate-900" : "h-8 w-8 text-xs ring-slate-50 dark:ring-slate-950")}>+{extra}</span>
      )}
    </div>
  );
}
