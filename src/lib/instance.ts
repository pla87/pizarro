// Ajustes de la instalación que elige el asistente de primer arranque (/setup) y se guardan en AppState:
// nombre de la organización, idioma por defecto y zona horaria. Las variables de entorno siguen mandando
// (APP_TIMEZONE gana al valor guardado). Se cambian después en Administración → Ajustes → Instalación.
import { db } from "./db";
import { AppError } from "./errors";
import { INSTANCE_TZ_GLOBAL } from "./format";
import { validTimeZone } from "./setup-core";
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

/**
 * Administración → Ajustes → Instalación: cambia lo que eligió el asistente. Devuelve los valores anteriores y los nuevos
 * (para el registro de actividad). Con APP_TIMEZONE la zona guardada no se toca: manda la variable.
 */
export async function saveInstanceSettings(
  input: { orgName: string; locale: string; timeZone: string },
  env: Record<string, string | undefined> = process.env,
): Promise<{ before: InstanceSettings; after: InstanceSettings }> {
  const orgName = String(input.orgName ?? "").trim();
  if (!orgName || orgName.length > 80) throw new AppError("Escribe el nombre de la organización (hasta 80 caracteres).");
  if (input.locale !== "es" && input.locale !== "en") throw new AppError("Idioma no válido.");
  const zoneLocked = Boolean(env.APP_TIMEZONE);
  if (!zoneLocked && !validTimeZone(String(input.timeZone ?? ""))) throw new AppError("Zona horaria no válida.");
  const keys = [INSTANCE_ORG_KEY, INSTANCE_LOCALE_KEY, INSTANCE_TZ_KEY];
  const before = parseInstance(await db.appState.findMany({ where: { key: { in: keys } }, select: { key: true, value: true } }));
  const entries: [string, string][] = [[INSTANCE_ORG_KEY, orgName], [INSTANCE_LOCALE_KEY, input.locale]];
  if (!zoneLocked) entries.push([INSTANCE_TZ_KEY, input.timeZone]);
  await db.$transaction(entries.map(([key, value]) => db.appState.upsert({ where: { key }, create: { key, value }, update: { value } })));
  invalidateInstance();
  return { before, after: await getInstanceSettings() };
}
