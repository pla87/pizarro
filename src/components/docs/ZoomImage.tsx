"use client";

import { useEffect, useRef, useState } from "react";
import { useT } from "@/i18n/client";
import { cn } from "@/components/ui/cn";

const ZOOM = 2.5;

/**
 * Imagen con zoom: un clic la amplía (2,5×) y, mientras está ampliada, mover el ratón la desplaza para que
 * la imagen siga al puntero y se pueda ver entera. Otro clic o Escape la devuelve a su tamaño.
 * Táctil: un toque amplía o reduce y arrastrar desplaza.
 */
export function ZoomImage({ src, alt }: { src: string; alt: string }) {
  const t = useT();
  const box = useRef<HTMLDivElement>(null);
  const img = useRef<HTMLImageElement>(null);
  // Posición del puntero (0..1) dentro del contenedor; null = sin zoom.
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const [size, setSize] = useState({ bw: 0, bh: 0, w: 0, h: 0 });
  const touch = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  const zoomed = pos !== null;

  // Escape reduce el zoom sin cerrar el visor (la fase de captura llega antes que el cierre del modal).
  useEffect(() => {
    if (!zoomed) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      setPos(null);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [zoomed]);

  const frac = (clientX: number, clientY: number) => {
    const r = box.current!.getBoundingClientRect();
    return { x: Math.min(1, Math.max(0, (clientX - r.left) / r.width)), y: Math.min(1, Math.max(0, (clientY - r.top) / r.height)) };
  };
  const zoomIn = (clientX: number, clientY: number) => {
    const b = box.current!;
    const i = img.current!;
    setSize({ bw: b.clientWidth, bh: b.clientHeight, w: i.offsetWidth, h: i.offsetHeight });
    setPos(frac(clientX, clientY));
  };

  // Con la imagen ampliada, el borde del contenedor se corresponde con el borde de la imagen: el puntero la recorre entera.
  const axis = (f: number, boxLen: number, imgLen: number) => {
    const scaled = imgLen * ZOOM;
    const left0 = (boxLen - imgLen) / 2;
    const left = scaled <= boxLen ? (boxLen - scaled) / 2 : f * (boxLen - scaled);
    return left - left0;
  };
  const transform = pos ? `translate(${axis(pos.x, size.bw, size.w)}px, ${axis(pos.y, size.bh, size.h)}px) scale(${ZOOM})` : "none";

  return (
    <div
      ref={box}
      role="button"
      tabIndex={0}
      aria-label={zoomed ? t("Reducir imagen") : t("Ampliar imagen")}
      aria-pressed={zoomed}
      data-testid="zoom-image"
      data-zoomed={zoomed ? "1" : "0"}
      className={cn(
        "relative flex h-full min-h-[40vh] w-full items-center justify-center overflow-hidden rounded outline-none focus-visible:outline-3 focus-visible:outline-focus",
        zoomed ? "cursor-zoom-out touch-none" : "cursor-zoom-in",
      )}
      onClick={(e) => {
        if (touch.current?.moved) return; // fin de un arrastre táctil, no un toque
        if (zoomed) setPos(null);
        else zoomIn(e.clientX, e.clientY);
      }}
      onKeyDown={(e) => {
        if (e.key !== "Enter" && e.key !== " ") return;
        e.preventDefault();
        if (zoomed) setPos(null);
        else {
          const r = box.current!.getBoundingClientRect();
          zoomIn(r.left + r.width / 2, r.top + r.height / 2);
        }
      }}
      onPointerDown={(e) => {
        if (e.pointerType !== "mouse") touch.current = { x: e.clientX, y: e.clientY, moved: false };
      }}
      onPointerMove={(e) => {
        if (!zoomed) return;
        if (e.pointerType === "mouse") return setPos(frac(e.clientX, e.clientY));
        const start = touch.current;
        if (!start) return;
        const dx = e.clientX - start.x;
        const dy = e.clientY - start.y;
        if (Math.abs(dx) + Math.abs(dy) > 6) start.moved = true;
        start.x = e.clientX;
        start.y = e.clientY;
        // Arrastrar mueve la imagen con el dedo: la fracción cambia sobre el recorrido disponible (negativo).
        setPos((p) => {
          if (!p) return p;
          const rx = size.bw - size.w * ZOOM;
          const ry = size.bh - size.h * ZOOM;
          return { x: rx < 0 ? Math.min(1, Math.max(0, p.x + dx / rx)) : p.x, y: ry < 0 ? Math.min(1, Math.max(0, p.y + dy / ry)) : p.y };
        });
      }}
      onPointerUp={() => {
        // El «click» llega justo después de soltar: el indicador se limpia más tarde.
        setTimeout(() => (touch.current = null), 0);
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        ref={img}
        src={src}
        alt={alt}
        draggable={false}
        style={{ transform, transformOrigin: "0 0" }}
        className="max-h-full max-w-full select-none rounded object-contain transition-transform duration-100 ease-out"
      />
    </div>
  );
}
