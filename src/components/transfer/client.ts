import type { TransferJobView } from "@/lib/transfer-jobs";

export type { TransferJobView };

/** Evento de ventana: una exportación o importación acaba de ponerse en cola (el vigilante empieza a consultarla). */
export const TRANSFER_QUEUED_EVENT = "pz:transfer-queued";

/** Trabajos cuyo final ya se ha enseñado en un panel: el aviso emergente no los repite. */
export const shownJobs = new Set<string>();

/** Trabajos que un panel abierto está consultando ahora mismo: el vigilante no avisa de ellos (el panel ya lo enseña). */
export const watchingJobs = new Set<string>();

const SEEN_PREFIX = "pz:transfer-seen:";
const SEEN_KEEP_MS = 7 * 24 * 60 * 60 * 1000;
const channel = typeof window !== "undefined" && typeof BroadcastChannel !== "undefined" ? new BroadcastChannel("pz-transfer-seen") : null;
// Otra pestaña ya enseñó (o va a enseñar) el final de este trabajo.
if (channel) channel.onmessage = (e: MessageEvent) => { if (typeof e.data === "string") shownJobs.add(e.data); };

function markSeen(id: string): boolean {
  try {
    if (localStorage.getItem(SEEN_PREFIX + id)) return false;
    localStorage.setItem(SEEN_PREFIX + id, String(Date.now()));
    // Limpieza de marcas viejas (las filas del servidor se borran a los 7 días).
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k?.startsWith(SEEN_PREFIX) && Date.now() - Number(localStorage.getItem(k)) > SEEN_KEEP_MS) localStorage.removeItem(k);
    }
  } catch {
    // sin almacenamiento: solo se evita repetir dentro de esta pestaña
  }
  return true;
}

/**
 * ¿Le toca a esta pestaña enseñar el aviso del final de `id`? Con varias pestañas abiertas solo una lo enseña: la marca en
 * localStorage se comprueba y escribe dentro de un bloqueo (Web Locks) para que dos pestañas a la vez no pasen las dos.
 */
export async function claimNotice(id: string): Promise<boolean> {
  if (shownJobs.has(id)) return false;
  const claim = async () => markSeen(id);
  let ok: boolean;
  try {
    ok = navigator.locks ? await navigator.locks.request("pz-transfer-seen", claim) : await claim();
  } catch {
    ok = await claim();
  }
  if (!ok) return false;
  shownJobs.add(id);
  channel?.postMessage(id);
  return true;
}

export const isFinal = (s: TransferJobView["status"]) => s === "DONE" || s === "FAILED" || s === "EXPIRED";

export function announceQueued(): void {
  window.dispatchEvent(new Event(TRANSFER_QUEUED_EVENT));
}

export async function fetchJob(id: string): Promise<{ job: TransferJobView | null; gone: boolean }> {
  const res = await fetch(`/api/transfer-jobs/${id}`, { cache: "no-store" });
  if (res.status === 404) return { job: null, gone: true };
  if (!res.ok) throw new Error(String(res.status));
  return { job: (await res.json()) as TransferJobView, gone: false };
}

/** Anota que la persona ya vio el final (no falla: es solo para no repetir el aviso). */
export function ackJob(id: string): void {
  shownJobs.add(id);
  markSeen(id);
  channel?.postMessage(id);
  void fetch(`/api/transfer-jobs/${id}/ack`, { method: "POST" }).catch(() => {});
}

/** Porcentaje de la fase actual; null si no se sabe (barra sin cifra). */
export function percent(p: TransferJobView["progress"]): number | null {
  return p.total && p.total > 0 && p.done !== undefined ? Math.min(100, Math.round((p.done / p.total) * 100)) : null;
}
