import "server-only";
import { db } from "./db";
import { DEFAULT_APP_ICON, parseAppIcon, type AppIconAccent } from "./app-icon-core";

/** Administración → Ajustes → «Icono de la app»: tema de color del icono de esta instalación (AppState). */
export const APP_ICON_KEY = "instance.appIcon";

// Memoria de proceso con vida corta, como los ajustes de la instalación (instance.ts): la piden el layout de cada página y
// el manifiesto. En globalThis para que la invalidación al guardar llegue a todas las copias del módulo (rutas, acciones).
const TTL_MS = 30_000;
// Si la consulta falla, el azul por defecto también se guarda unos segundos: sin esto, cada petición de favicon
// (la pide el navegador por pestaña y por página) reintentaría la consulta a una base que no responde.
export const FAILURE_TTL_MS = 10_000;
const cache = ((globalThis as unknown as { __pzAppIcon?: { value: { value: AppIconAccent; at: number; ttl?: number } | null } }).__pzAppIcon ??= { value: null });

/** Tema del icono de la app (con caché). Sin elegir, o si la base de datos falla, el azul de siempre. */
export async function getAppIcon(now: number = Date.now()): Promise<AppIconAccent> {
  const cached = cache.value;
  if (cached && now - cached.at < (cached.ttl ?? TTL_MS)) return cached.value;
  try {
    const row = await db.appState.findUnique({ where: { key: APP_ICON_KEY }, select: { value: true } });
    const value = parseAppIcon(row?.value) ?? DEFAULT_APP_ICON;
    cache.value = { value, at: now };
    return value;
  } catch {
    cache.value = { value: DEFAULT_APP_ICON, at: now, ttl: FAILURE_TTL_MS };
    return DEFAULT_APP_ICON;
  }
}

export async function setAppIcon(accent: AppIconAccent): Promise<void> {
  await db.appState.upsert({ where: { key: APP_ICON_KEY }, create: { key: APP_ICON_KEY, value: accent }, update: { value: accent } });
  cache.value = null;
}
