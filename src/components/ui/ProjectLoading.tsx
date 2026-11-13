"use client";

import { useEffect, useState } from "react";
import { useT } from "@/i18n/client";

/** Las cargas más rápidas que esto no enseñan nada (ni lo anuncia el lector de pantalla): así no parpadea. */
const SHOW_AFTER_MS = 200;

/** Rectángulo de esquinas redondeadas como trazado (un <path> admite `pathLength` en todos los navegadores). */
function roundedRect(x: number, y: number, w: number, h: number, r: number) {
  return `M${x + r} ${y}H${x + w - r}A${r} ${r} 0 0 1 ${x + w} ${y + r}V${y + h - r}A${r} ${r} 0 0 1 ${x + w - r} ${y + h}H${x + r}A${r} ${r} 0 0 1 ${x} ${y + h - r}V${y + r}A${r} ${r} 0 0 1 ${x + r} ${y}Z`;
}

// El logo de Pizarro (BrandMark) solo con el contorno: el marco y las tres columnas.
const MARK = [roundedRect(0.5, 0.5, 31, 31, 7), roundedRect(6, 7, 5.5, 18, 1.5), roundedRect(13.25, 7, 5.5, 12, 1.5), roundedRect(20.5, 7, 5.5, 7, 1.5)];

/**
 * Mientras carga una página de proyecto (tablero, releases, documentación, ajustes): el contorno del logo
 * dibujándose, centrado en el hueco de la página (la barra lateral se queda). Aparece a los 200 ms (CSS, así que
 * también antes de hidratar) y entonces anuncia «Cargando…». Con movimiento reducido, el logo quieto y tenue.
 * Animación y retardo: `.project-loader` en globals.css.
 */
export function ProjectLoading() {
  const t = useT();
  const [announce, setAnnounce] = useState(false);
  useEffect(() => {
    const id = setTimeout(() => setAnnounce(true), SHOW_AFTER_MS);
    return () => clearTimeout(id);
  }, []);
  return (
    <div className="flex h-full min-h-48 items-center justify-center p-4" data-project-loading>
      <svg
        className="project-loader h-14 w-14 text-slate-400 dark:text-slate-500"
        viewBox="0 0 32 32"
        fill="none"
        stroke="currentColor"
        strokeWidth={0.6}
        strokeLinejoin="round"
        aria-hidden
      >
        {MARK.map((d) => <path key={d} d={d} pathLength={1} />)}
      </svg>
      {/* Región viva vacía al montar: el texto llega después y así el lector de pantalla lo anuncia. */}
      <p role="status" className="sr-only">{announce ? t("Cargando…") : ""}</p>
    </div>
  );
}
