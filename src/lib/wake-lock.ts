// Pantalla encendida mientras dura algo (el dictado por voz): Screen Wake Lock API. Sin dependencias del DOM, para
// probarlo con un `navigator.wakeLock` de mentira.

/** Lo que devuelve `navigator.wakeLock.request("screen")`. */
interface WakeLockSentinelLike {
  readonly released: boolean;
  release(): Promise<void>;
}

/** `navigator.wakeLock`. */
interface WakeLockApi {
  request(type: "screen"): Promise<WakeLockSentinelLike>;
}

interface ScreenWakeLock {
  /** Pide que la pantalla no se apague (hasta `release`). */
  hold(): void;
  /**
   * La pestaña vuelve a verse: el navegador suelta el bloqueo al ocultarla, así que se pide de nuevo si se sigue queriendo
   * y ya no está activo.
   */
  resume(): void;
  /** Ya no hace falta: suelta el bloqueo (también uno que aún estuviera pidiéndose). */
  release(): void;
}

/**
 * Bloqueo de la pantalla con su estado: se pide como mucho uno a la vez y, si se suelta antes de que el navegador lo
 * conceda, se suelta en cuanto llega. Sin la API (Firefox antiguo, http sin TLS) o si el navegador lo niega (ahorro de
 * batería, pestaña oculta), no hace nada y no lanza.
 */
export function screenWakeLock(api: () => WakeLockApi | null | undefined): ScreenWakeLock {
  let wanted = false;
  let sentinel: WakeLockSentinelLike | null = null;
  let requesting = false;

  const drop = (s: WakeLockSentinelLike) => {
    void s.release().catch(() => {});
  };

  const acquire = () => {
    if (!wanted || requesting || (sentinel && !sentinel.released)) return;
    let wl: WakeLockApi | null | undefined;
    try {
      wl = api();
    } catch {
      wl = null;
    }
    if (!wl || typeof wl.request !== "function") return;
    requesting = true;
    let pending: Promise<WakeLockSentinelLike>;
    try {
      pending = wl.request("screen");
    } catch {
      requesting = false;
      return;
    }
    pending.then(
      (s) => {
        requesting = false;
        if (wanted) sentinel = s;
        else drop(s);
      },
      () => {
        requesting = false;
      },
    );
  };

  return {
    hold() {
      wanted = true;
      acquire();
    },
    resume() {
      acquire();
    },
    release() {
      wanted = false;
      const s = sentinel;
      sentinel = null;
      if (s && !s.released) drop(s);
    },
  };
}
