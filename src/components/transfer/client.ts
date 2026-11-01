import type { TransferJobView } from "@/lib/transfer-jobs";

export type { TransferJobView };

/** Evento de ventana: una exportación o importación acaba de ponerse en cola (el vigilante empieza a consultarla). */
export const TRANSFER_QUEUED_EVENT = "pz:transfer-queued";

/** Trabajos cuyo final ya se ha enseñado en un panel: el aviso emergente no los repite. */
export const shownJobs = new Set<string>();

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
  void fetch(`/api/transfer-jobs/${id}/ack`, { method: "POST" }).catch(() => {});
}

/** Porcentaje de la fase actual; null si no se sabe (barra sin cifra). */
export function percent(p: TransferJobView["progress"]): number | null {
  return p.total && p.total > 0 && p.done !== undefined ? Math.min(100, Math.round((p.done / p.total) * 100)) : null;
}
