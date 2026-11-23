import { useSyncExternalStore } from "react";
import type { useT } from "@/i18n/client";
import type { useToast } from "../ui/Toast";

// Descargas de una columna que se generan en el servidor (el PDF de «Generar plan»): se piden con fetch y se guardan con
// un <a download>, sin salir del tablero ni abrir otra pestaña. Una a la vez por clave (botón y menú comparten el
// estado): mientras tanto el botón se ve ocupado, y un error (429, sin red) sale en un aviso.

const inFlight = new Set<string>();
const listeners = new Set<() => void>();
const changed = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

/** ¿Se está descargando `key`? */
export function useDownloadBusy(key: string): boolean {
  return useSyncExternalStore(subscribe, () => inFlight.has(key), () => false);
}

/** Nombre del fichero que da el servidor en Content-Disposition (o `fallback`). */
function fileNameOf(res: Response, fallback: string): string {
  return /filename="?([^";]+)"?/i.exec(res.headers.get("Content-Disposition") ?? "")?.[1] ?? fallback;
}

/**
 * Pide `url` y guarda lo que devuelve. `failed`: el aviso si el servidor responde con un error sin texto propio;
 * `offline`: el aviso sin conexión. Devuelve si se descargó.
 */
export async function downloadFile(
  key: string, url: string, texts: { fallbackName: string; failed: string; offline: string },
  t: ReturnType<typeof useT>, toast: ReturnType<typeof useToast>,
): Promise<boolean> {
  if (inFlight.has(key)) return false;
  inFlight.add(key);
  changed();
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) {
      const text = (await res.text().catch(() => "")).trim();
      toast(res.status === 429 ? t("Demasiadas peticiones, espera un momento.") : text && text.length < 300 ? text : texts.failed, "error");
      return false;
    }
    const blob = await res.blob();
    const href = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = href;
    a.download = fileNameOf(res, texts.fallbackName);
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(href), 60_000);
    return true;
  } catch {
    toast(texts.offline, "error");
    return false;
  } finally {
    inFlight.delete(key);
    changed();
  }
}
