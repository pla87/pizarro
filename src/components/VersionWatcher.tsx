"use client";

import { RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import { useT } from "@/i18n/client";
import { NEW_VERSION_EVENT } from "@/lib/stale-action";

const CHECK_MS = 5 * 60_000;
const BUILD = process.env.NEXT_PUBLIC_BUILD_ID ?? "";

/** ¿Hay algo a medias (un modal abierto o un campo con foco)? Entonces no se recarga sola. */
export function busy(): boolean {
  const active = document.activeElement as HTMLElement | null;
  return !!document.querySelector("[role=dialog]") || !!active?.closest("input, textarea, select, [contenteditable=true]");
}

/** Recarga la página una vez (no más de una cada 30 s, para no entrar en bucle). */
export function reloadForNewVersion(): boolean {
  try {
    const last = Number(sessionStorage.getItem("pzReloadAt") ?? 0);
    if (Date.now() - last < 30_000) return false;
    sessionStorage.setItem("pzReloadAt", String(Date.now()));
  } catch {
    // Sin sessionStorage se recarga igualmente.
  }
  window.location.reload();
  return true;
}

/**
 * Tras un despliegue, una pestaña abierta tiene el código anterior y sus acciones ya no existen en
 * el servidor. Se comprueba la versión al volver a la pestaña y cada 5 minutos: si ha cambiado, se
 * recarga sola cuando no hay nada a medias o se ofrece un botón para hacerlo.
 */
export function VersionWatcher() {
  const t = useT();
  const [outdated, setOutdated] = useState(false);

  useEffect(() => {
    if (!BUILD || BUILD.endsWith("-dev")) return;
    let stale = false;
    const check = async () => {
      if (document.visibilityState !== "visible") return;
      if (!stale) {
        try {
          const res = await fetch("/api/version", { cache: "no-store" });
          const { build } = (await res.json()) as { build: string };
          stale = !!build && build !== BUILD;
        } catch {
          return;
        }
      }
      if (!stale) return;
      if (!busy()) reloadForNewVersion();
      else setOutdated(true);
    };
    // Una acción ha fallado por ser de una versión anterior: se avisa ya, sin recargar (puede haber texto sin guardar).
    const onStale = () => setOutdated(true);
    window.addEventListener(NEW_VERSION_EVENT, onStale);
    const timer = setInterval(check, CHECK_MS);
    document.addEventListener("visibilitychange", check);
    window.addEventListener("focus", check);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", check);
      window.removeEventListener("focus", check);
      window.removeEventListener(NEW_VERSION_EVENT, onStale);
    };
  }, []);

  if (!outdated) return null;
  return (
    <div className="fixed inset-x-3 top-[calc(env(safe-area-inset-top)+0.75rem)] z-[60] mx-auto flex max-w-md items-center gap-2 rounded-xl border border-brand-200 bg-white p-2 pl-3 text-sm shadow-xl dark:border-brand-500/40 dark:bg-slate-900">
      <span className="flex-1">{t("Hay una versión nueva de Pizarro. Recarga para seguir.")}</span>
      <button className="btn-primary px-2.5 py-1.5" onClick={() => window.location.reload()}>
        <RefreshCw size={15} /> {t("Recargar")}
      </button>
    </div>
  );
}
