"use client";

import { Share, Smartphone } from "lucide-react";
import { useEffect, useState } from "react";
import { Modal } from "./ui/Modal";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

/**
 * «Instalar app»: en Android/Chrome usa el aviso nativo de instalación; en iPhone/iPad
 * (Safari no lo tiene) muestra cómo añadirla a la pantalla de inicio.
 */
export function InstallApp() {
  const [prompt, setPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [ios, setIos] = useState(false);
  const [installed, setInstalled] = useState(true);
  const [help, setHelp] = useState(false);

  useEffect(() => {
    navigator.serviceWorker?.register("/sw.js").catch(() => {});
    const standalone =
      window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
    const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setPrompt(e as BeforeInstallPromptEvent);
    };
    const onInstalled = () => setInstalled(true);
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    // Estado que solo se conoce en el navegador: se fija tras montar.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setIos(isIos);
    setInstalled(standalone);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  if (installed || (!prompt && !ios)) return null;

  return (
    <>
      <button
        type="button"
        className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
        onClick={async () => {
          if (prompt) {
            await prompt.prompt();
            const choice = await prompt.userChoice;
            if (choice.outcome === "accepted") setInstalled(true);
            setPrompt(null);
          } else setHelp(true);
        }}
      >
        <Smartphone size={17} /> Instalar app
      </button>
      <Modal open={help} onClose={() => setHelp(false)} title="Añadir Pizarro a la pantalla de inicio" size="sm">
        <ol className="list-decimal space-y-2 pl-5 text-sm">
          <li>Abre Pizarro en <strong>Safari</strong>.</li>
          <li>
            Pulsa el botón <strong>Compartir</strong> <Share size={14} className="inline align-text-bottom" /> (abajo en iPhone, arriba en iPad).
          </li>
          <li>Elige <strong>Añadir a pantalla de inicio</strong> y pulsa <strong>Añadir</strong>.</li>
        </ol>
        <p className="mt-3 text-xs text-slate-500">Se abrirá a pantalla completa, como una app, y mantendrá tu sesión.</p>
      </Modal>
    </>
  );
}
