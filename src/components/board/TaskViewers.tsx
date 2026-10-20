"use client";

import { Users } from "lucide-react";
import { useEffect, useState } from "react";

const POLL_MS = 15_000;

/** Aviso «Fulano también tiene abierta esta tarea» (para no pisarse al editar). */
export function TaskViewers({ taskId }: { taskId: string }) {
  const [others, setOthers] = useState<{ id: string; name: string }[]>([]);

  useEffect(() => {
    let cancelled = false;
    const ping = async () => {
      if (document.visibilityState !== "visible") return;
      try {
        const res = await fetch(`/api/tasks/${taskId}/viewers`, { cache: "no-store" });
        if (res.ok && !cancelled) setOthers(((await res.json()) as { others: { id: string; name: string }[] }).others);
      } catch {
        // Sin conexión: se mantiene lo último conocido.
      }
    };
    void ping();
    const timer = setInterval(ping, POLL_MS);
    document.addEventListener("visibilitychange", ping);
    return () => {
      cancelled = true;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", ping);
      void fetch(`/api/tasks/${taskId}/viewers`, { method: "DELETE", keepalive: true }).catch(() => {});
    };
  }, [taskId]);

  if (!others.length) return null;
  const names = others.map((o) => o.name);
  const text = names.length === 1 ? `${names[0]} también tiene abierta esta tarea` : `${names.slice(0, -1).join(", ")} y ${names.at(-1)} también tienen abierta esta tarea`;
  return (
    <div className="flex items-center gap-2 rounded-lg bg-amber-50 px-3 py-1.5 text-xs text-amber-800 dark:bg-amber-500/10 dark:text-amber-200" role="status">
      <Users size={14} className="shrink-0" /> {text}.
    </div>
  );
}
