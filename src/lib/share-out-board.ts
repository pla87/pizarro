// «Compartir fuera» en el tablero: lo que sabe el navegador de una columna compartida (sin dependencias del servidor: lo
// usan ColumnView, ShareColumn y el servidor al preparar el tablero). Nunca lleva el token.
import { isAssignColumn } from "./column-assign-core";

/** BoardColumn.share: el estado del enlace de una columna «Compartir fuera». */
export interface BoardShareInfo {
  state: "none" | "active" | "ended";
  /** Hasta cuándo vale si no se usa (activo) o cuándo terminó (ISO). */
  endsAt: string | null;
  expiryDays: number;
  generatedAt: string | null;
  generatedByName: string | null;
  /** Tareas publicadas en la última generación. */
  published: number;
}

/**
 * ¿Es una columna «Compartir fuera»? Con su fila (share), rol NONE y sin «Asignación a persona»: si un deshacer le devolvió
 * otro rol, vuelve a ser una columna de ese rol (y su enlace deja de funcionar).
 */
export function isShareColumn(c: { role: string; assigneeId?: string | null; assignDueDays?: number | null; share?: unknown }): boolean {
  return c.share != null && c.role === "NONE" && !isAssignColumn(c);
}

/** Lo que dice la cabecera y el informe del estado del enlace (clave de traducción y fecha). */
export function shareStateText(info: Pick<BoardShareInfo, "state" | "endsAt">): { key: "Enlace activo hasta el {date}" | "Enlace caducado" | "Web sin generar"; date: string | null } {
  if (info.state === "active") return { key: "Enlace activo hasta el {date}", date: info.endsAt };
  if (info.state === "ended") return { key: "Enlace caducado", date: null };
  return { key: "Web sin generar", date: null };
}

/** Días sin uso tras los que caduca el enlace: lo que rota el selector del pie de la columna. */
const SHARE_EXPIRY_DAYS = [7, 30, 90] as const;
type ShareExpiryDays = (typeof SHARE_EXPIRY_DAYS)[number];
export const DEFAULT_SHARE_EXPIRY_DAYS: ShareExpiryDays = 30;
export const isShareExpiry = (n: unknown): n is ShareExpiryDays => SHARE_EXPIRY_DAYS.includes(n as ShareExpiryDays);
/** Siguiente valor del selector (7 días → 1 mes → 3 meses → 7 días). Uno desconocido vuelve al de por defecto. */
export function nextShareExpiry(n: number): ShareExpiryDays {
  const i = SHARE_EXPIRY_DAYS.indexOf(n as ShareExpiryDays);
  return i < 0 ? DEFAULT_SHARE_EXPIRY_DAYS : SHARE_EXPIRY_DAYS[(i + 1) % SHARE_EXPIRY_DAYS.length]!;
}
/** Texto del selector (clave de traducción). */
export function shareExpiryLabel(n: number): "7 días" | "1 mes" | "3 meses" {
  return n === 7 ? "7 días" : n === 90 ? "3 meses" : "1 mes";
}

const DAY = 86_400_000;

/** Lo que importa de una fila para saber cómo está su enlace. */
interface ShareLinkRow {
  columnId: string | null;
  tokenHash: string | null;
  expiryDays: number;
  generatedAt: Date | null;
  lastUsedAt: Date | null;
  revokedAt: Date | null;
}

/**
 * Estado del enlace actual: `none` (sin generar), `active` (vale hasta `endsAt` si no se usa) o `ended` (caducó o se
 * revocó en `endsAt`). Una fila sin columna (borrada o sin la función) cuenta como terminada.
 */
export function shareLinkState(row: ShareLinkRow, now: Date = new Date()): { state: "none" | "active" | "ended"; endsAt: Date | null } {
  if (!row.tokenHash) return { state: "none", endsAt: null };
  const used = row.lastUsedAt ?? row.generatedAt;
  const expires = used ? new Date(used.getTime() + row.expiryDays * DAY) : null;
  if (row.revokedAt) return { state: "ended", endsAt: expires && expires < row.revokedAt ? expires : row.revokedAt };
  if (!row.columnId) return { state: "ended", endsAt: expires && expires < now ? expires : (used ?? now) };
  if (!expires || expires <= now) return { state: "ended", endsAt: expires ?? now };
  return { state: "active", endsAt: expires };
}

/** Campos de ColumnShare que necesita el tablero (con `columns: { select: { share: … } } }`). */
export const SHARE_BOARD_SELECT = { columnId: true, tokenHash: true, expiryDays: true, generatedAt: true, generatedByName: true, lastUsedAt: true, revokedAt: true, taskIds: true } as const;

export function boardShareOf(row: { columnId: string | null; tokenHash: string | null; expiryDays: number; generatedAt: Date | null; generatedByName: string | null; lastUsedAt: Date | null; revokedAt: Date | null; taskIds: string[] }, now: Date = new Date()): BoardShareInfo {
  const { state, endsAt } = shareLinkState(row, now);
  return {
    state,
    endsAt: endsAt?.toISOString() ?? null,
    expiryDays: row.expiryDays,
    generatedAt: row.generatedAt?.toISOString() ?? null,
    generatedByName: row.generatedByName,
    published: row.taskIds.length,
  };
}


/**
 * Enlace `mailto:` para mandar la dirección desde el correo de quien comparte (Pizarro no envía nada). Asunto y cuerpo ya
 * traducidos; sin destinatario (lo pone quien lo envía).
 */
export function shareMailto(subject: string, body: string): string {
  return `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}
