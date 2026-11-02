"use client";

import { Share, Smartphone } from "lucide-react";
import { useState, useSyncExternalStore } from "react";
import { useT } from "@/i18n/client";
import { Modal } from "./ui/Modal";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

interface InstallState {
  /** Aviso nativo de instalación (Android/Chrome) guardado para usarlo al pulsar el botón; solo sirve una vez. */
  prompt: BeforeInstallPromptEvent | null;
  /** iPhone/iPad: Safari no tiene aviso nativo, el botón explica cómo añadirla a la pantalla de inicio. */
  ios: boolean;
  /** Ya abierta como app (o recién instalada): no se ofrece. */
  installed: boolean;
}

// Estado compartido por todas las copias del botón: la barra lateral se monta dos veces (escritorio, oculta por CSS en
// el móvil, y el menú móvil, que solo existe mientras está abierto). `beforeinstallprompt` llega una sola vez y antes
// se lo quedaba la copia oculta; ahora se recoge aquí, al cargar el módulo, y lo ve cualquier copia montada después.
const SERVER_STATE: InstallState = { prompt: null, ios: false, installed: true };
let state: InstallState = SERVER_STATE;
const listeners = new Set<() => void>();

function setState(patch: Partial<InstallState>) {
  state = { ...state, ...patch };
  for (const l of listeners) l();
}

if (typeof window !== "undefined") {
  const standalone =
    window.matchMedia?.("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  state = { prompt: null, ios, installed: standalone };
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    setState({ prompt: e as BeforeInstallPromptEvent });
  });
  window.addEventListener("appinstalled", () => setState({ installed: true, prompt: null }));
  // El service worker (necesario para instalar) se registra una sola vez, no por cada copia del botón.
  navigator.serviceWorker?.register("/sw.js").catch(() => {});
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * «Instalar app»: en Android/Chrome usa el aviso nativo de instalación; en iPhone/iPad
 * (Safari no lo tiene) muestra cómo añadirla a la pantalla de inicio.
 */
export function InstallApp() {
  const t = useT();
  // En el servidor y durante la hidratación no se pinta (lo que se sabe del navegador llega justo después).
  const { prompt, ios, installed } = useSyncExternalStore(subscribe, () => state, () => SERVER_STATE);
  const [help, setHelp] = useState(false);

  if (installed || (!prompt && !ios)) return null;

  return (
    <>
      <button
        type="button"
        className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
        onClick={async () => {
          if (prompt) {
            // El evento solo admite un prompt(): se retira ya para todas las copias (Chrome manda otro si hace falta).
            setState({ prompt: null });
            await prompt.prompt();
            const choice = await prompt.userChoice;
            if (choice.outcome === "accepted") setState({ installed: true });
          } else setHelp(true);
        }}
      >
        <Smartphone size={17} /> {t("Instalar app")}
      </button>
      <Modal open={help} onClose={() => setHelp(false)} title={t("Añadir Pizarro a la pantalla de inicio")} size="sm">
        <ol className="list-decimal space-y-2 pl-5 text-sm">
          <li>{t("Abre Pizarro en")} <strong>Safari</strong>.</li>
          <li>
            {t("Pulsa el botón")} <strong>{t("Compartir")}</strong> <Share size={14} className="inline align-text-bottom" /> {t("(abajo en iPhone, arriba en iPad).")}
          </li>
          <li>{t("Elige")} <strong>{t("Añadir a pantalla de inicio")}</strong> {t("y pulsa")} <strong>{t("Añadir")}</strong>.</li>
        </ol>
        <p className="mt-3 text-xs text-slate-500">{t("Se abrirá a pantalla completa, como una app, y mantendrá tu sesión.")}</p>
      </Modal>
    </>
  );
}
