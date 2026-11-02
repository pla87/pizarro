"use client";

import { useCallback, useSyncExternalStore } from "react";
import { useT } from "@/i18n/client";
import { Avatar } from "../ui/Avatar";
import { cn } from "../ui/cn";
import { setTaskViewers, type TaskViewer } from "./taskPresence";

const POLL_MS = 20_000;
const MAX_SHOWN = 5;
const MAX_COMPACT = 3; // cabecera móvil: círculos pequeños y solo 3

type ActiveUser = { id: string; name: string };
const NONE: ActiveUser[] = [];

/**
 * Un solo sondeo por proyecto, compartido por todos los círculos montados (la cabecera de escritorio y la móvil
 * están siempre montadas, una oculta por CSS): empieza con el primero que se suscribe y para con el último.
 */
interface Feed {
  users: ActiveUser[];
  listeners: Set<() => void>;
  stop: () => void;
}
const feeds = new Map<string, Feed>();

function startFeed(projectId: string): Feed {
  let cancelled = false;
  const feed: Feed = { users: NONE, listeners: new Set(), stop: () => {} };
  const load = async () => {
    if (document.visibilityState !== "visible") return;
    try {
      const res = await fetch(`/api/projects/${projectId}/presence`, { cache: "no-store" });
      if (res.ok && !cancelled) {
        const json = (await res.json()) as { users: ActiveUser[]; viewers?: Record<string, TaskViewer[]> };
        feed.users = json.users;
        setTaskViewers(json.viewers ?? {});
        for (const l of feed.listeners) l();
      }
    } catch {
      // Sin conexión: se mantiene lo último conocido.
    }
  };
  const timer = setInterval(load, POLL_MS);
  window.addEventListener("focus", load);
  feed.stop = () => {
    cancelled = true;
    clearInterval(timer);
    window.removeEventListener("focus", load);
  };
  void load();
  return feed;
}

function subscribeFeed(projectId: string, listener: () => void): () => void {
  const feed = feeds.get(projectId) ?? startFeed(projectId);
  feeds.set(projectId, feed);
  feed.listeners.add(listener);
  return () => {
    feed.listeners.delete(listener);
    if (feed.listeners.size === 0 && feeds.get(projectId) === feed) {
      feed.stop();
      feeds.delete(projectId);
    }
  };
}

/** Círculos con las iniciales de quien ha hecho algo en este tablero en los últimos 5 minutos. */
export function Presence({ projectId, compact }: { projectId: string; compact?: boolean }) {
  const t = useT();
  const subscribe = useCallback((listener: () => void) => subscribeFeed(projectId, listener), [projectId]);
  const users = useSyncExternalStore(subscribe, () => feeds.get(projectId)?.users ?? NONE, () => NONE);

  if (users.length === 0) return null;
  const max = compact ? MAX_COMPACT : MAX_SHOWN;
  const extra = users.length - max;
  const names = users.map((u) => u.name).join(", ");
  return (
    <div className="flex items-center -space-x-1.5" title={t("Activos en los últimos 5 minutos: {names}", { names })} aria-label={t("Activos en los últimos 5 minutos: {names}", { names })}>
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
