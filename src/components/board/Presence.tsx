"use client";

import { useCallback, useSyncExternalStore } from "react";
import { useT } from "@/i18n/client";
import { Avatar } from "../ui/Avatar";
import { cn } from "../ui/cn";
import { setTaskViewers, type TaskViewer } from "./taskPresence";

const POLL_MS = 60_000;
const MAX_SHOWN = 5;
const MAX_COMPACT = 3; // cabecera móvil: círculos pequeños y solo 3

type ActiveUser = { id: string; name: string };
const NONE: ActiveUser[] = [];

/**
 * Quién está en cada tablero. Lo normal es que llegue por el canal en vivo del tablero (evento `presence`, Board.tsx:
 * `setLivePresence`), con el estado completo al conectar y después cada cambio. Sin canal (no soportado, aún sin conectar
 * o caído) se pregunta como antes, cada 60 s y al volver a la ventana: un solo sondeo por proyecto, compartido por todos
 * los círculos montados (la cabecera de escritorio y la móvil están siempre montadas, una oculta por CSS).
 */
interface Feed {
  users: ActiveUser[];
  listeners: Set<() => void>;
  stop: () => void;
}
const feeds = new Map<string, Feed>();
/** Proyecto cuyo canal en vivo está abierto ahora (entonces no se sondea). */
let liveProject: string | null = null;
/** Último estado recibido por el canal, por si llega antes de que se monten los círculos. */
const liveUsers = new Map<string, ActiveUser[]>();

function notify(projectId: string) {
  const feed = feeds.get(projectId);
  if (feed) for (const l of feed.listeners) l();
}

/** El canal en vivo del proyecto se ha abierto (con su primer estado) o se ha cerrado (`null`). */
export function setLiveProject(projectId: string | null): void {
  if (liveProject && liveProject !== projectId) liveUsers.delete(liveProject);
  liveProject = projectId;
}

/** Estado de presencia recibido por el canal en vivo del tablero (los demás que tienen abierta cada tarea, ya sin la propia persona). */
export function setLivePresence(projectId: string, users: ActiveUser[], viewers: Record<string, TaskViewer[]>): void {
  liveUsers.set(projectId, users);
  setTaskViewers(viewers);
  const feed = feeds.get(projectId);
  if (feed && JSON.stringify(feed.users) !== JSON.stringify(users)) {
    feed.users = users;
    notify(projectId);
  }
}

function startFeed(projectId: string): Feed {
  let cancelled = false;
  const feed: Feed = { users: liveUsers.get(projectId) ?? NONE, listeners: new Set(), stop: () => {} };
  const load = async () => {
    if (cancelled || document.visibilityState !== "visible" || liveProject === projectId) return;
    try {
      const res = await fetch(`/api/projects/${projectId}/presence`, { cache: "no-store" });
      // Si mientras tanto se ha abierto el canal, manda lo que llegue por él.
      if (res.ok && !cancelled && liveProject !== projectId) {
        const json = (await res.json()) as { users: ActiveUser[]; viewers?: Record<string, TaskViewer[]> };
        feed.users = json.users;
        setTaskViewers(json.viewers ?? {});
        notify(projectId);
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
  // Al montar, el canal aún se está abriendo: se le da un momento antes de preguntar.
  setTimeout(() => void load(), 3000);
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
