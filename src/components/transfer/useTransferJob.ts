"use client";

import { useEffect, useRef, useState } from "react";
import { ackJob, announceQueued, fetchJob, isFinal, watchingJobs, type TransferJobView } from "./client";

const POLL_MS = 2000;

/**
 * Consulta el trabajo cada 2 s hasta que termina. `onFinal` se llama una vez con el estado final (y se anota que ya
 * se vio, para que el aviso emergente no lo repita). `gone` es que ya no existe (o no es de esta persona).
 */
export function useTransferJob(id: string | null, onFinal?: (job: TransferJobView) => void): { job: TransferJobView | null; gone: boolean } {
  const [state, setState] = useState<{ id: string | null; job: TransferJobView | null; gone: boolean }>({ id: null, job: null, gone: false });
  const finalRef = useRef(onFinal);
  useEffect(() => {
    finalRef.current = onFinal;
  });
  useEffect(() => {
    if (!id) return;
    watchingJobs.add(id);
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      try {
        const { job, gone } = await fetchJob(id);
        if (stopped) return;
        setState({ id, job, gone });
        if (gone) return;
        if (job && isFinal(job.status)) {
          ackJob(id);
          finalRef.current?.(job);
          return;
        }
      } catch {
        // fallo de red puntual: se reintenta
      }
      if (!stopped) timer = setTimeout(tick, POLL_MS);
    };
    void tick();
    return () => {
      stopped = true;
      watchingJobs.delete(id);
      clearTimeout(timer);
      // Si el panel se cierra con el trabajo aún en curso, el vigilante vuelve a consultar: no se le escapa un final justo ahora.
      announceQueued();
    };
  }, [id]);
  return state.id === id ? { job: state.job, gone: state.gone } : { job: null, gone: false };
}
