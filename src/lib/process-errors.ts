// Errores que escapan a todo (sin petición asociada: temporizadores, tareas de fondo, eventos sin oyente).
// Next.js ya los escribe en la consola y no deja que tumben el proceso; aquí además se guardan en
// Administración → Logs y, ante una excepción no capturada en producción, se sale para que Docker/Railway
// reinicien un proceso limpio (el estado tras una excepción así no es fiable).

const MAX_REJECTIONS_PER_HOUR = 20;
const EXIT_GRACE_MS = 2000;

/**
 * ¿Hay que salir tras una excepción no capturada? Solo en producción y con EXIT_ON_UNCAUGHT_EXCEPTION=1 (lo fija el
 * compose propio, que reinicia sin límite). En Railway los reintentos son limitados: por defecto solo se registra.
 */
export function shouldExitOnUncaught(env: Record<string, string | undefined> = process.env): boolean {
  return env.NODE_ENV === "production" && env.EXIT_ON_UNCAUGHT_EXCEPTION === "1";
}

function describe(value: unknown): { message: string; stack?: string } {
  if (value instanceof Error) return { message: value.message, stack: value.stack?.split("\n").slice(0, 6).join("\n") };
  return { message: String(value) };
}

/** Registra los oyentes una sola vez por proceso. */
export function installProcessErrorHandlers(): void {
  const g = globalThis as unknown as { __pzProcessErrors?: { windowStart: number; count: number } };
  if (g.__pzProcessErrors) return;
  const state = (g.__pzProcessErrors = { windowStart: Date.now(), count: 0 });

  process.on("unhandledRejection", (reason) => {
    // Next provoca algunas a propósito (promesas que se lanzan antes de saber si se usarán): con tope, para no llenar los logs.
    if (Date.now() - state.windowStart > 3_600_000) Object.assign(state, { windowStart: Date.now(), count: 0 });
    if (++state.count > MAX_REJECTIONS_PER_HOUR) return;
    const { message, stack } = describe(reason);
    void import("@/lib/log")
      .then(({ logEvent }) => logEvent({ level: "warn", category: "system", action: "system.unhandledRejection", message: `Promesa rechazada sin capturar: ${message}`, details: { stack } }))
      .catch(() => {});
  });

  process.on("uncaughtException", (err, origin) => {
    const exit = shouldExitOnUncaught();
    const { message, stack } = describe(err);
    void import("@/lib/log")
      .then(async ({ logEvent, flushLogs }) => {
        logEvent({ level: "error", category: "system", action: "system.uncaughtException", message: `Excepción no capturada (${origin})${exit ? ", se reinicia el proceso" : ""}: ${message}`, details: { stack } });
        if (exit) await flushLogs();
      })
      .catch(() => {})
      .finally(() => {
        if (exit) process.exit(1);
      });
    // Por si guardar el log se queda colgado (p. ej. sin base de datos).
    if (exit) setTimeout(() => process.exit(1), EXIT_GRACE_MS);
  });
}
