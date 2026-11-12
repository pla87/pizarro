"use client";

import { Wifi, WifiOff } from "lucide-react";
import { useEffect, useState, useSyncExternalStore } from "react";
import { useT } from "@/i18n/client";
import { isOffline, subscribeConnection } from "@/lib/connection";

const RESTORED_MS = 4000;

/**
 * Aviso fijo «Sin conexión» mientras el servidor no responde (sin red, servidor caído o reiniciándose) y «Conexión
 * recuperada» unos segundos al volver. Lo que se hace sin conexión no se guarda (cada acción lo avisa); los refrescos
 * esperan a que vuelva (lib/connection.ts).
 */
export function ConnectionNotice() {
  const t = useT();
  const offline = useSyncExternalStore(subscribeConnection, isOffline, () => false);
  const [seen, setSeen] = useState(offline);
  // Vueltas de la conexión: el aviso «Conexión recuperada» de cada una dura lo suyo aunque vuelva dos veces seguidas.
  const [returns, setReturns] = useState(0);
  const [restored, setRestored] = useState(0);
  if (seen !== offline) {
    setSeen(offline);
    if (offline) setRestored(0);
    else {
      setReturns(returns + 1);
      setRestored(returns + 1);
    }
  }
  useEffect(() => {
    if (!restored) return;
    const timer = setTimeout(() => setRestored(0), RESTORED_MS);
    return () => clearTimeout(timer);
  }, [restored]);
  if (!offline && !restored) return null;
  // Solo informa (no hay nada que pulsar): no recibe toques, que pasan a lo que tenga debajo (tarjetas, asas, casillas).
  // En móvil va por encima de los botones flotantes de crear («+» y «Crear varias tareas», hasta 8,25rem del pie). Con
  // la barra de selección (que va a 1rem del pie y retira esos botones), por encima de ella en cualquier ancho: lo que
  // ocupa lo publica SelectionBar en `--selection-bar-space`.
  return (
    <div
      className="pointer-events-none fixed inset-x-0 bottom-[calc(env(safe-area-inset-bottom)+1rem+var(--selection-bar-space,0px))] z-[80] flex justify-center px-4 max-md:bottom-[calc(env(safe-area-inset-bottom)+max(9rem,1rem+var(--selection-bar-space,0px)))]"
      role="status"
      aria-live="polite"
    >
      <div
        data-connection={offline ? "offline" : "restored"}
        className={
          offline
            ? "flex max-w-md items-center gap-2 rounded-lg bg-amber-700 px-4 py-2.5 text-sm font-medium text-white shadow-lg"
            : "flex max-w-md items-center gap-2 rounded-lg bg-emerald-700 px-4 py-2.5 text-sm font-medium text-white shadow-lg"
        }
      >
        {offline ? <WifiOff size={16} className="shrink-0" aria-hidden /> : <Wifi size={16} className="shrink-0" aria-hidden />}
        <span>{offline ? t("Sin conexión. Lo que cambies no se guardará hasta que vuelva.") : t("Conexión recuperada")}</span>
      </div>
    </div>
  );
}
