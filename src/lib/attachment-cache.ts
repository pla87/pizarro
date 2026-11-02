import "server-only";

// (La lectura de BD y del disco está en attachment-lookup.ts; este módulo no importa nada pesado para poder usarlo
// desde uploads.ts.)
// Caché en memoria de lo que /api/attachments/[id] necesita de un adjunto para revalidar una imagen (el 304 del
// navegador, que se repite por cada miniatura en cada carga del tablero): a qué proyecto pertenece, si es imagen,
// su nombre y tipo y, por variante, tamaño y fecha del fichero (para el ETag). Todo eso es inmutable mientras el adjunto
// exista. NO guarda permisos: el acceso se decide siempre en cada petición (access-cache.ts, que revoke.ts vacía
// al quitar el acceso). Esta caché solo debe evitar servir un adjunto ya borrado, y por eso:
//  - TTL corto (5 s): tope de seguridad si algún borrado no avisara;
//  - se vacía en los puntos que borran adjuntos (forgetAttachments / forgetTaskAttachments / forgetProjectAttachments);
//  - solo se guardan los que existen (un adjunto nuevo se ve al instante) y, para servir el cuerpo (200), siempre se
//    vuelve a hacer stat del fichero: la caché solo se usa para contestar 304.

const TTL_MS = 5_000;
const MAX_ENTRIES = 5000;

export type Variant = "full" | "thumb" | "file";

export interface AttachmentMeta {
  id: string;
  taskId: string;
  projectId: string;
  isImage: boolean;
  originalName: string;
  mimeType: string;
}

interface Entry {
  meta: AttachmentMeta;
  until: number;
  files: Partial<Record<Variant, { size: number; mtimeMs: number; until: number }>>;
}

const store = (globalThis as unknown as { __pzAttachmentCache?: Map<string, Entry> }).__pzAttachmentCache ??= new Map();

function trim(now: number) {
  if (store.size <= MAX_ENTRIES) return;
  for (const [k, e] of store) if (e.until <= now) store.delete(k);
  // Si seguía lleno de entradas vivas, se tira la más antigua (orden de inserción).
  while (store.size > MAX_ENTRIES) store.delete(store.keys().next().value as string);
}

/** Metadatos guardados y vigentes de un adjunto (undefined si no hay o caducaron). */
export function cachedMeta(id: string): AttachmentMeta | undefined {
  const hit = store.get(id);
  return hit && hit.until > Date.now() ? hit.meta : undefined;
}

/**
 * Generación de la caché: cada «olvidar» la sube. Quien leyó la BD antes de un borrado no puede guardar después
 * metadatos ya obsoletos (storeMeta descarta lo leído con una generación anterior).
 */
// En globalThis, como el almacén: acciones y rutas pueden empaquetarse por separado y deben ver el mismo contador.
const gen = (globalThis as unknown as { __pzAttachmentCacheEpoch?: { n: number } }).__pzAttachmentCacheEpoch ??= { n: 0 };
export const cacheEpoch = (): number => gen.n;

/** Guarda los metadatos de un adjunto que existe (los inexistentes no se guardan), si nada se olvidó desde `readAt`. */
export function storeMeta(meta: AttachmentMeta, readAt: number = gen.n): void {
  if (readAt !== gen.n) return;
  const now = Date.now();
  store.delete(meta.id);
  store.set(meta.id, { meta, until: now + TTL_MS, files: {} });
  trim(now);
}

export function dropMeta(id: string): void {
  store.delete(id);
}

/** Tamaño y fecha guardados y vigentes de una variante del fichero. */
export function cachedFileStat(id: string, variant: Variant): { size: number; mtimeMs: number } | undefined {
  const f = store.get(id)?.files[variant];
  return f && f.until > Date.now() ? f : undefined;
}

export function storeFileStat(meta: AttachmentMeta, variant: Variant, value: { size: number; mtimeMs: number }): void {
  const live = store.get(meta.id);
  if (live && live.meta === meta) live.files[variant] = { ...value, until: Date.now() + TTL_MS };
}

/** Olvida estos adjuntos (borrados o con los ficheros quitados). */
export function forgetAttachments(ids: Iterable<string>): void {
  gen.n++;
  for (const id of ids) store.delete(id);
}

/** Olvida los adjuntos de estas tareas (tareas borradas: sus filas caen en cascada). */
export function forgetTaskAttachments(taskIds: Iterable<string>): void {
  gen.n++;
  const set = new Set(taskIds);
  for (const [k, e] of store) if (set.has(e.meta.taskId)) store.delete(k);
}

/** Olvida los adjuntos de un proyecto (borrado o con el acceso cambiado). */
export function forgetProjectAttachments(projectId: string): void {
  gen.n++;
  for (const [k, e] of store) if (e.meta.projectId === projectId) store.delete(k);
}
