// Ajustes de la instalación que elige el asistente de primer arranque (/setup) y se guardan en AppState:
// nombre de la organización, idioma por defecto y zona horaria. Las variables de entorno siguen mandando
// (APP_TIMEZONE gana al valor guardado).
import { db } from "./db";
import { INSTANCE_TZ_GLOBAL } from "./format";
import { INSTANCE_LOCALE_KEY, INSTANCE_ORG_KEY, INSTANCE_TZ_KEY, parseInstance, type InstanceSettings } from "./instance-core";

export { INSTANCE_LOCALE_KEY, INSTANCE_ORG_KEY, INSTANCE_TZ_KEY, parseInstance, type InstanceSettings } from "./instance-core";

/** Zona horaria guardada, leída por appTimeZone() (síncrona, en format.ts) de esta variable global: se rellena al cargar los ajustes. */
const TZ_GLOBAL = INSTANCE_TZ_GLOBAL;

// Memoria de proceso con vida corta: los cambios de otro proceso se ven en unos segundos. En globalThis: las rutas /api
// (manifiesto, calendario, webhooks) son otra copia del módulo y, con una variable del módulo, no veían la invalidación
// al guardar el idioma o la zona horaria hasta 30 s después.
const TTL_MS = 30_000;
const cache = ((globalThis as unknown as { __pzInstanceSettings?: { value: { value: InstanceSettings; at: number } | null } }).__pzInstanceSettings ??= { value: null });

/** Ajustes de la instalación (con caché). Si la base de datos falla, valores por defecto: nunca rompe una página. */
export async function getInstanceSettings(now: number = Date.now()): Promise<InstanceSettings> {
  const cached = cache.value;
  if (cached && now - cached.at < TTL_MS) return cached.value;
  let value: InstanceSettings;
  try {
    const rows = await db.appState.findMany({ where: { key: { in: [INSTANCE_ORG_KEY, INSTANCE_LOCALE_KEY, INSTANCE_TZ_KEY] } }, select: { key: true, value: true } });
    value = parseInstance(rows);
  } catch {
    return { orgName: "", locale: "es", timeZone: "" };
  }
  cache.value = { value, at: now };
  (globalThis as unknown as Record<string, string>)[TZ_GLOBAL] = value.timeZone;
  return value;
}

export function invalidateInstance(): void {
  cache.value = null;
}
