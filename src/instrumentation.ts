// Punto central de Next.js para registrar los errores no capturados del servidor (Administración → Logs).
export async function onRequestError(
  err: unknown,
  request: { path: string; method: string },
  context: { routerKind: string; routePath: string; routeType: string },
) {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { logEvent } = await import("@/lib/log");
  const e = err as { message?: string; digest?: string; stack?: string };
  logEvent({
    level: "error",
    category: "system",
    action: "system.uncaughtError",
    message: `Error no controlado en ${request.method} ${request.path}: ${e?.message ?? String(err)}`,
    path: request.path,
    details: { digest: e?.digest, route: context.routePath, routeType: context.routeType, stack: e?.stack?.split("\n").slice(0, 6).join("\n") },
  });
}

// Arranque del servidor: lanza el mantenimiento periódico (solo runtime Node; imports dinámicos para no tocar el bundle edge).
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  try {
    const { startMaintenance } = await import("@/lib/maintenance");
    startMaintenance();
  } catch (err) {
    console.error("[instrumentation] no se pudo iniciar el mantenimiento", err);
  }
}
