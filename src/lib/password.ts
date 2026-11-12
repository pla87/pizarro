import bcrypt from "bcryptjs";
import { z } from "zod";
import { runBcrypt } from "./bcrypt-pool";
import { AppError } from "./errors";
import { releaseRateLimit } from "./rate-limit";
import { isSemaphoreFull, Semaphore } from "./semaphore";

const COST = 11;
export const MIN_PASSWORD = 10;
/** bcrypt solo usa los primeros 72 BYTES: más allá se ignoraría sin avisar (y las tildes ocupan 2). */
export const MAX_PASSWORD_BYTES = 72;

export function passwordByteLength(plain: string): number {
  return new TextEncoder().encode(plain).length;
}

/** Contraseña nueva: mínimo 10 caracteres y máximo 72 bytes en UTF-8. */
export function passwordSchema(minMessage = "La contraseña debe tener al menos 10 caracteres.") {
  return z
    .string()
    .min(MIN_PASSWORD, minMessage)
    .refine((p) => passwordByteLength(p) <= MAX_PASSWORD_BYTES, "La contraseña es demasiado larga (máximo 72 bytes; las tildes y los emojis ocupan más de uno).");
}

// Cuántas comprobaciones (y cálculos) de contraseña van a la vez en todo el servidor. bcrypt es caro a propósito (~0,2 s
// cada una): sin tope, una ráfaga de intentos de acceso ocupaba la CPU y, en el hilo principal, dejaba esperando a todos.
// Lo que no cabe espera su turno; si la espera pasa de PASSWORD_MAX_WAIT_MS (el tope real), o la cola ya tiene todo lo
// que se puede atender en ese tiempo, se responde «demasiados a la vez».
export const PASSWORD_CHECKS_AT_ONCE = 2;
export const PASSWORD_MAX_WAIT_MS = 3_000;
/** Lo que tarda una comprobación (coste 11), para dimensionar la cola. */
const BCRYPT_ESTIMATE_MS = 200;
/**
 * Cola: las que caben en la espera máxima (3 s / 0,2 s × 2 = 30). Antes eran 8 y una ráfaga de 20 accesos a la vez (una
 * clase entera entrando) rechazaba 10 al instante aunque las demás terminaban en ~1,5 s.
 */
export const PASSWORD_QUEUE = Math.floor((PASSWORD_MAX_WAIT_MS / BCRYPT_ESTIMATE_MS) * PASSWORD_CHECKS_AT_ONCE);

/** Respuesta cuando ya hay demasiadas comprobaciones de contraseña en curso (no dice nada de la cuenta). */
export const PASSWORD_BUSY_MESSAGE = "Demasiados intentos a la vez, prueba en unos segundos.";

export class PasswordBusyError extends AppError {
  constructor() {
    super(PASSWORD_BUSY_MESSAGE, 429, "password_busy");
  }
}

/** ¿Es el rechazo por demasiadas comprobaciones a la vez? (por código: la clase puede venir de otro paquete de Next). */
export function isPasswordBusy(err: unknown): boolean {
  return err instanceof Error && (err as { code?: unknown }).code === "password_busy";
}

// En globalThis: acciones y rutas pueden empaquetarse por separado y deben compartir el mismo tope.
const g = globalThis as unknown as { __pzPasswordSem?: Semaphore };
const slots = (g.__pzPasswordSem ??= new Semaphore({ max: PASSWORD_CHECKS_AT_ONCE, maxQueue: PASSWORD_QUEUE, maxWaitMs: PASSWORD_MAX_WAIT_MS }));

/** Comprobaciones en curso y en espera (pruebas y diagnóstico). */
export function passwordCheckStats(): { active: number; waiting: number } {
  return slots.stats;
}

async function limited<T>(fn: () => Promise<T>, bounded: boolean): Promise<T> {
  try {
    return await slots.run(fn, { bounded });
  } catch (err) {
    if (isSemaphoreFull(err)) throw new PasswordBusyError();
    throw err;
  }
}

/**
 * Hash de una contraseña nueva. Comparte el tope con las comprobaciones, pero espera su turno sin límite de cola ni de
 * tiempo: lo piden personas con sesión (cambio de contraseña, altas de usuarios), quien trae un enlace válido de
 * restablecimiento o de invitación (el enlace se gasta antes de calcularlo, y la ruta tiene su límite por IP), el
 * asistente de instalación y la semilla. Nadie puede provocarlo en ráfaga sin cuenta ni enlace.
 */
export function hashPassword(plain: string): Promise<string> {
  return limited(() => runBcrypt({ op: "hash", plain, cost: COST }, () => bcrypt.hash(plain, COST)), false);
}

/** ¿Es `plain` la contraseña de `hash`? Lanza PasswordBusyError si ya hay demasiadas comprobaciones en curso. */
export function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return limited(() => runBcrypt({ op: "compare", plain, hash }, () => bcrypt.compare(plain, hash)), true);
}

/**
 * verifyPassword tras un límite de intentos ya contado en `rateKey` (rateLimit antes de comprobar): si el servidor está
 * ocupado, la contraseña no se ha llegado a mirar, así que ese intento se devuelve (no gasta el cupo de la persona) y
 * se relanza el PasswordBusyError («demasiados intentos a la vez, prueba en unos segundos»). Como en el acceso.
 */
export async function verifyPasswordCounted(plain: string, hash: string, rateKey: string): Promise<boolean> {
  try {
    return await verifyPassword(plain, hash);
  } catch (err) {
    if (isPasswordBusy(err)) releaseRateLimit(rateKey);
    throw err;
  }
}

// Hash fijo (de un valor sin uso, con el mismo coste) para igualar el tiempo de respuesta cuando el usuario no existe.
// Precalculado: antes se calculaba en la primera petición, y eso costaba otra operación de bcrypt.
const DUMMY_HASH = "$2b$11$p6baAcxS8zXOyptLk2Wx.u2ajIIoOYQsqgPN8I4YOjEnBAQesKpfa";
export function dummyVerify(plain: string): Promise<boolean> {
  return verifyPassword(plain, DUMMY_HASH);
}
