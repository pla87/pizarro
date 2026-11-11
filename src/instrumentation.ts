// Punto central de Next.js para registrar los errores no capturados del servidor (Administración → Logs).
export async function onRequestError(
  err: unknown,
  request: { path: string; method: string },
  context: { routerKind: string; routePath: string; routeType: string },
) {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { logEvent } = await import("@/lib/log");
  const { maskSecretsFor } = await import("@/lib/secret-path");
  const e = err as { message?: string; digest?: string; stack?: string };
  // Rutas con credencial en la URL (token del calendario, enlaces de /reset/ y /confirm/): ni en la ruta ni en el mensaje.
  const mask = (text: string) => maskSecretsFor(text, request.path);
  const path = mask(request.path);
  logEvent({
    level: "error",
    category: "system",
    action: "system.uncaughtError",
    message: `Error no controlado en ${request.method} ${path}: ${mask(e?.message ?? String(err))}`,
    path,
    details: { digest: e?.digest, route: context.routePath, routeType: context.routeType, stack: mask(e?.stack?.split("\n").slice(0, 6).join("\n") ?? "") || undefined },
  });
}

// Arranque del servidor: registra los errores del proceso y lanza el mantenimiento periódico (solo runtime Node; imports dinámicos para no tocar el bundle edge).
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  try {
    const { installProcessErrorHandlers } = await import("@/lib/process-errors");
    installProcessErrorHandlers();
  } catch (err) {
    console.error("[instrumentation] no se pudieron registrar los errores del proceso", err);
  }
  // Apagado ordenado (SIGTERM/SIGINT): espera a las peticiones y los emails en curso y guarda los registros. Requiere
  // NEXT_MANUAL_SIG_HANDLE=1 (Dockerfile, scripts/start.sh, `npm start`); ver lib/shutdown.ts.
  try {
    const { installShutdownHandlers } = await import("@/lib/shutdown");
    installShutdownHandlers();
  } catch (err) {
    console.error("[instrumentation] no se pudo registrar el apagado ordenado", err);
  }
  try {
    const { startMaintenance } = await import("@/lib/maintenance");
    startMaintenance();
  } catch (err) {
    console.error("[instrumentation] no se pudo iniciar el mantenimiento", err);
  }
  // Zona horaria elegida en el asistente de primer arranque: disponible desde la primera acción, no solo tras renderizar el layout.
  try {
    const { getInstanceSettings } = await import("@/lib/instance");
    await getInstanceSettings();
  } catch (err) {
    console.error("[instrumentation] no se pudieron cargar los ajustes de la instalación", err);
  }
  // Configuración del envío de emails guardada en Administración: emailEnabled() es síncrona y lee esta copia en memoria.
  try {
    const { refreshMailConfig } = await import("@/lib/mail-config");
    await refreshMailConfig();
  } catch (err) {
    console.error("[instrumentation] no se pudo cargar la configuración de email", err);
  }
  // Ídem para el acceso con Google guardado en Administración (googleEnabled() es síncrona).
  try {
    const { refreshGoogleConfig } = await import("@/lib/google-config");
    await refreshGoogleConfig();
  } catch (err) {
    console.error("[instrumentation] no se pudo cargar la configuración de Google", err);
  }
  // Bot de Telegram activado en Administración: se vuelve a registrar el webhook (por si cambió APP_URL) o se arranca
  // el sondeo en segundo plano. Sin esperar: Telegram puede tardar y el arranque no depende de ello.
  try {
    const { syncTelegram } = await import("@/lib/telegram");
    void syncTelegram().catch((err) => console.error("[instrumentation] no se pudo preparar el bot de Telegram", err));
  } catch (err) {
    console.error("[instrumentation] no se pudo preparar el bot de Telegram", err);
  }
}
