import "server-only";
import { db } from "./db";

/** Máximo de comentarios por tarea (ajuste de administración): valor por defecto y márgenes permitidos. */
export const COMMENT_LIMIT_DEFAULT = 500;
export const COMMENT_LIMIT_MIN = 1;
export const COMMENT_LIMIT_MAX = 1000;
export const COMMENT_LIMIT_KEY = "maxCommentsPerTask";

/** Un valor guardado vale solo si es un entero dentro de los márgenes; si no, se usa el predeterminado. */
export function parseCommentLimit(raw: string | null | undefined): number {
  const n = Number(raw);
  return raw != null && Number.isInteger(n) && n >= COMMENT_LIMIT_MIN && n <= COMMENT_LIMIT_MAX ? n : COMMENT_LIMIT_DEFAULT;
}

// Memoria de proceso: se lee a menudo (cada comentario) y casi nunca cambia. Se invalida al guardar;
// el tiempo de vida corto cubre otros procesos que compartan la base de datos.
const TTL_MS = 30_000;
let cached: { value: number; at: number } | null = null;

export async function getMaxCommentsPerTask(now: number = Date.now()): Promise<number> {
  if (cached && now - cached.at < TTL_MS) return cached.value;
  const row = await db.appState.findUnique({ where: { key: COMMENT_LIMIT_KEY }, select: { value: true } });
  const value = parseCommentLimit(row?.value);
  cached = { value, at: now };
  return value;
}

export async function setMaxCommentsPerTask(value: number): Promise<void> {
  const v = String(value);
  await db.appState.upsert({ where: { key: COMMENT_LIMIT_KEY }, create: { key: COMMENT_LIMIT_KEY, value: v }, update: { value: v } });
  invalidateAppSettings();
}

export function invalidateAppSettings(): void {
  cached = null;
}
