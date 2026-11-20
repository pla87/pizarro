"use client";

import { Users } from "lucide-react";
import { useEffect, useState } from "react";
import { useT } from "@/i18n/client";
import { useLiveStream, useTaskViewers, type TaskViewer } from "./taskPresence";

const POLL_MS = 15_000;

/**
 * Aviso «Fulano también tiene abierta esta tarea» (para no pisarse al editar).
 *
 * Con el canal en vivo del tablero abierto, la tarea se anuncia una vez (con el id del canal) y quién más la tiene abierta
 * llega por el canal (evento `presence`). Sin canal, como antes: aviso cada 15 s, que también trae a los demás.
 */
export function TaskViewers({ taskId }: { taskId: string }) {
  const t = useT();
  const stream = useLiveStream();
  const live = useTaskViewers(taskId);
  const [polled, setPolled] = useState<{ taskId: string; others: TaskViewer[] } | null>(null);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | null = null;
    const url = `/api/tasks/${taskId}/viewers${stream ? `?stream=${stream}` : ""}`;
    const ping = async () => {
      if (document.visibilityState !== "visible") return;
      try {
        const res = await fetch(url, { cache: "no-store" });
        if (!res.ok || cancelled) return;
        const json = (await res.json()) as { others: TaskViewer[]; live?: boolean };
        if (cancelled) return;
        setPolled(json.live ? null : { taskId, others: json.others });
        // El servidor no conoce el canal (p. ej. otra instancia): se sigue avisando cada 15 s.
        if (!json.live && !timer) timer = setInterval(ping, POLL_MS);
      } catch {
        // Sin conexión: se mantiene lo último conocido.
      }
    };
    // El cierre (DELETE) sale después de que el primer aviso haya terminado: abriendo y cerrando muy deprisa, el DELETE
    // podía llegar antes y la tarea quedaba abierta mientras durase el canal.
    const first = ping();
    // Con canal basta el primer aviso (se reanuncia si el canal se reabre: cambia `stream`).
    if (!stream) {
      timer = setInterval(ping, POLL_MS);
      document.addEventListener("visibilitychange", ping);
    }
    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
      document.removeEventListener("visibilitychange", ping);
      void first.finally(() => fetch(url, { method: "DELETE", keepalive: true }).catch(() => {}));
    };
  }, [taskId, stream]);

  const others = polled && polled.taskId === taskId ? polled.others : live;
  if (!others.length) return null;
  const names = others.map((o) => o.name);
  const text = names.length === 1
    ? t("{name} también tiene abierta esta tarea", { name: names[0]! })
    : t("{names} y {last} también tienen abierta esta tarea", { names: names.slice(0, -1).join(", "), last: names.at(-1)! });
  return (
    <div className="flex items-center gap-2 rounded-lg bg-amber-50 px-3 py-1.5 text-xs text-amber-800 dark:bg-amber-500/10 dark:text-amber-200" role="status">
      <Users size={14} className="shrink-0" /> {text}.
    </div>
  );
}
