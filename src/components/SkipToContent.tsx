"use client";

import { useEffect } from "react";
import { useT } from "@/i18n/client";

/** id del `<main>` de la aplicación (AppShell): destino del enlace y del foco al llegar. */
export const MAIN_ID = "contenido";

const mainEl = () => document.getElementById(MAIN_ID);

/**
 * «Saltar al contenido»: primer elemento del Tab en todas las páginas de la aplicación, oculto hasta que recibe el foco.
 * Lleva el foco al contenido principal sin pasar por el menú lateral (y sin cambiar la dirección con un #).
 *
 * Además, al montarse la aplicación (al entrar tras iniciar sesión o al cargar una página), si el foco no está en ningún
 * sitio (en el body, como deja la navegación desde el acceso), lo pone en el contenido principal: el lector de pantalla
 * empieza por la página y el siguiente Tab va a su primer control. Si la página ya ha enfocado algo, no lo toca.
 */
export function SkipToContent() {
  const t = useT();
  useEffect(() => {
    const active = document.activeElement;
    if (active && active !== document.body && active.isConnected) return;
    mainEl()?.focus({ preventScroll: true });
  }, []);
  return (
    <a
      href={`#${MAIN_ID}`}
      onClick={(e) => {
        const main = mainEl();
        if (!main) return;
        e.preventDefault();
        main.focus();
      }}
      className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[100] focus:rounded-lg focus:bg-white focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:text-brand-700 focus:shadow-lg focus:ring-2 focus:ring-focus dark:focus:bg-slate-900 dark:focus:text-brand-300"
    >
      {t("Saltar al contenido")}
    </a>
  );
}
