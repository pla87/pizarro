// Semáforo en memoria: como mucho `max` tareas a la vez; las demás esperan en una cola corta. Si la cola está llena o
// la espera pasa de `maxWaitMs`, la tarea no se ejecuta (SemaphoreFullError). Sin dependencias: lo usa password.ts.

export class SemaphoreFullError extends Error {
  constructor(readonly reason: "queue" | "timeout") {
    super(reason === "queue" ? "Cola llena" : "Espera agotada");
    this.name = "SemaphoreFullError";
  }
}

/**
 * ¿Es un rechazo del semáforo? Por nombre y no con instanceof: un semáforo guardado en globalThis puede haberlo creado
 * otro paquete de Next (acciones, rutas y páginas se empaquetan por separado), con su propia copia de la clase.
 */
export function isSemaphoreFull(err: unknown): err is SemaphoreFullError {
  return err instanceof Error && err.name === "SemaphoreFullError";
}

interface SemaphoreOptions {
  /** Tareas a la vez. */
  max: number;
  /** Tareas que pueden esperar turno (las que lleguen con la cola llena se rechazan al momento). */
  maxQueue: number;
  /** Espera máxima de una tarea en la cola. */
  maxWaitMs: number;
}

type Waiter = { grant: () => void; timer: ReturnType<typeof setTimeout> | null; bounded: boolean };

export class Semaphore {
  private active = 0;
  private queue: Waiter[] = [];
  /** Esperas con tope en la cola (las que cuentan para maxQueue): un contador, sin recorrer la cola en cada llegada. */
  private boundedWaiting = 0;
  constructor(private readonly opts: SemaphoreOptions) {}

  /** Tareas en marcha y en espera (para pruebas y diagnóstico). */
  get stats(): { active: number; waiting: number } {
    return { active: this.active, waiting: this.queue.length };
  }

  /**
   * Ejecuta `fn` cuando haya hueco. `bounded: false` (p. ej. calcular el hash de una contraseña nueva, que no puede
   * provocar nadie desde fuera) espera su turno sin tope de cola ni de tiempo.
   */
  async run<T>(fn: () => Promise<T>, { bounded = true }: { bounded?: boolean } = {}): Promise<T> {
    await this.acquire(bounded);
    try {
      return await fn();
    } finally {
      this.release();
    }
  }

  private acquire(bounded: boolean): Promise<void> {
    if (this.active < this.opts.max && this.queue.length === 0) {
      this.active++;
      return Promise.resolve();
    }
    if (bounded && this.boundedWaiting >= this.opts.maxQueue) return Promise.reject(new SemaphoreFullError("queue"));
    return new Promise<void>((resolve, reject) => {
      const waiter: Waiter = {
        grant: () => {
          if (waiter.timer) clearTimeout(waiter.timer);
          if (waiter.bounded) this.boundedWaiting--;
          this.active++;
          resolve();
        },
        timer: null,
        bounded,
      };
      if (bounded) {
        this.boundedWaiting++;
        waiter.timer = setTimeout(() => {
          this.boundedWaiting--;
          const i = this.queue.indexOf(waiter);
          if (i >= 0) this.queue.splice(i, 1);
          reject(new SemaphoreFullError("timeout"));
        }, this.opts.maxWaitMs);
      }
      this.queue.push(waiter);
    });
  }

  private release(): void {
    this.active--;
    const next = this.queue.shift();
    if (next) next.grant();
  }
}
