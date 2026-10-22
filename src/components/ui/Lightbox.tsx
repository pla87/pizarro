"use client";

import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { useT } from "@/i18n/client";
import { useBackToClose } from "./useBackToClose";

interface LightboxImage {
  src: string;
  alt?: string;
  /** Enlace de descarga (opcional). */
  downloadHref?: string;
}

interface Props {
  images: LightboxImage[];
  index: number;
  onIndexChange: (index: number) => void;
  onClose: () => void;
}

/** Imagen a pantalla completa. Se cierra con la X, tocando fuera de la imagen o con Escape (solo ella, no el modal de debajo). */
export function Lightbox({ images, index, onIndexChange, onClose }: Props) {
  const t = useT();
  const stateRef = useRef({ images, index, onIndexChange, onClose });
  useEffect(() => {
    stateRef.current = { images, index, onIndexChange, onClose };
  });

  useBackToClose(true, () => stateRef.current.onClose());

  // Foco dentro al abrir y de vuelta al elemento anterior al cerrar.
  const closeRef = useRef<HTMLButtonElement>(null);
  const hasImage = !!images[index];
  useEffect(() => {
    if (!hasImage) return;
    const previous = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    return () => previous?.focus?.();
  }, [hasImage]);

  useEffect(() => {
    // En captura sobre window, antes del listener del Modal (document), que respeta defaultPrevented.
    const onKey = (e: KeyboardEvent) => {
      const s = stateRef.current;
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        s.onClose();
      } else if ((e.key === "ArrowLeft" || e.key === "ArrowRight") && s.images.length > 1) {
        const target = e.target as HTMLElement | null;
        if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
        e.preventDefault();
        e.stopPropagation();
        const step = e.key === "ArrowLeft" ? -1 : 1;
        s.onIndexChange((s.index + step + s.images.length) % s.images.length);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  const image = images[index];
  if (!image || typeof document === "undefined") return null;
  const many = images.length > 1;
  const go = (step: number) => onIndexChange((index + step + images.length) % images.length);

  return createPortal(
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/85 p-4 sm:p-8"
      role="dialog"
      aria-modal="true"
      aria-label={t("Imagen ampliada")}
      onClick={onClose}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={image.src}
        alt={image.alt ?? ""}
        className="max-h-full max-w-full rounded-lg object-contain"
        onClick={(e) => e.stopPropagation()}
      />
      <button
        ref={closeRef}
        type="button"
        className="absolute top-[max(1rem,env(safe-area-inset-top))] right-4 rounded-full bg-black/60 p-2 text-white hover:bg-black/80"
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
        aria-label={t("Cerrar imagen")}
      >
        <X size={22} />
      </button>
      {image.downloadHref && (
        <a
          href={image.downloadHref}
          onClick={(e) => e.stopPropagation()}
          className="btn-secondary absolute top-[max(1rem,env(safe-area-inset-top))] right-16"
        >
          {t("Descargar")}
        </a>
      )}
      {many && (
        <>
          <button
            type="button"
            className="absolute top-1/2 left-2 -translate-y-1/2 rounded-full bg-black/60 p-2 text-white hover:bg-black/80"
            onClick={(e) => { e.stopPropagation(); go(-1); }}
            aria-label={t("Imagen anterior")}
          >
            <ChevronLeft size={22} />
          </button>
          <button
            type="button"
            className="absolute top-1/2 right-2 -translate-y-1/2 rounded-full bg-black/60 p-2 text-white hover:bg-black/80"
            onClick={(e) => { e.stopPropagation(); go(1); }}
            aria-label={t("Imagen siguiente")}
          >
            <ChevronRight size={22} />
          </button>
        </>
      )}
    </div>,
    document.body,
  );
}
