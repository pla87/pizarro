// Asistente de primer arranque (/setup): estado, código de un solo uso y creación de la instalación.
// Sin "server-only" ni imports de Next: lo usa también scripts/boot.ts (empaquetado con esbuild).
import type { PrismaClient } from "@/generated/prisma/client";
import { AppError } from "./errors";
import { INSTANCE_LOCALE_KEY, INSTANCE_ORG_KEY, INSTANCE_TZ_KEY, invalidateInstance } from "./instance";
import { hashPassword, passwordSchema } from "./password";
import { createInitialAdmin, seed } from "./seed";
import { generateSetupCode, hashSetupCode, parseStoredCode, setupPending, validTimeZone, verifySetupCode, type StoredSetupCode } from "./setup-core";

export const SETUP_CODE_KEY = "setup.code";
/** Clave del bloqueo consultivo de Postgres que serializa la finalización del asistente. */
const SETUP_LOCK = 727_274_001;

let doneForever = false;

/** ¿Falta crear la instalación? Una vez que hay usuarios deja de consultarse la base de datos. */
export async function isSetupPending(db: Pick<PrismaClient, "user">, env: Record<string, string | undefined> = process.env): Promise<boolean> {
  if (doneForever) return false;
  const pending = setupPending(await db.user.count(), env);
  if (!pending && !(env.SEED_ADMIN_EMAIL?.trim() && env.SEED_ADMIN_PASSWORD)) doneForever = true;
  return pending;
}

/** Solo para los tests: olvida que ya hay usuarios. */
export function resetSetupCache(): void {
  doneForever = false;
}

/** Código de un solo uso nuevo en AppState (sustituye al anterior). Devuelve el código en claro para mostrarlo en el log. */
export async function issueSetupCode(db: Pick<PrismaClient, "appState">, now: number = Date.now()): Promise<{ code: string; stored: StoredSetupCode }> {
  const code = generateSetupCode();
  const stored = hashSetupCode(code, now);
  const value = JSON.stringify(stored);
  await db.appState.upsert({ where: { key: SETUP_CODE_KEY }, create: { key: SETUP_CODE_KEY, value }, update: { value } });
  return { code, stored };
}

/** Arranque: si el asistente está pendiente, genera un código nuevo y lo imprime en el log del contenedor. */
export async function announceSetup(db: PrismaClient, log: (msg: string) => void = console.log, env: Record<string, string | undefined> = process.env): Promise<string | null> {
  if (!(await isSetupPending(db, env))) {
    // Ya hay instalación (o administrador por variables): ningún código debe quedar vivo.
    await db.appState.deleteMany({ where: { key: SETUP_CODE_KEY } });
    return null;
  }
  const { code } = await issueSetupCode(db);
  const base = (env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
  const bar = "=".repeat(64);
  log(bar);
  log("[setup] PIZARRO ESTÁ SIN CONFIGURAR");
  log(`[setup] Abre ${base}/setup e introduce el código: ${code}`);
  log("[setup] El código caduca en 24 horas y cambia en cada arranque mientras falte la configuración.");
  if (env.SETUP_TOKEN?.trim()) log("[setup] También vale el valor de SETUP_TOKEN.");
  log(bar);
  return code;
}

/** ¿Es correcto el código (el del log o SETUP_TOKEN)? */
export async function checkSetupCode(db: Pick<PrismaClient, "appState">, input: string, now: number = Date.now(), env: Record<string, string | undefined> = process.env): Promise<boolean> {
  const row = await db.appState.findUnique({ where: { key: SETUP_CODE_KEY }, select: { value: true } });
  return verifySetupCode(String(input ?? "").slice(0, 100), parseStoredCode(row?.value), now, env.SETUP_TOKEN);
}

export interface SetupInput {
  code: string;
  orgName: string;
  locale: "es" | "en";
  timeZone: string;
  adminName: string;
  adminEmail: string;
  adminPassword: string;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** Valida los datos del asistente; lanza AppError con el primer problema. */
export function validateSetupInput(i: Omit<SetupInput, "code">): { orgName: string; adminName: string; adminEmail: string } {
  const orgName = i.orgName.trim();
  if (!orgName || orgName.length > 80) throw new AppError("Escribe el nombre de la organización (hasta 80 caracteres).");
  if (i.locale !== "es" && i.locale !== "en") throw new AppError("Idioma no válido.");
  if (!validTimeZone(i.timeZone)) throw new AppError("Zona horaria no válida.");
  const adminName = i.adminName.trim();
  if (!adminName || adminName.length > 100) throw new AppError("Escribe tu nombre (hasta 100 caracteres).");
  const adminEmail = i.adminEmail.trim().toLowerCase();
  if (adminEmail.length > 200 || !EMAIL_RE.test(adminEmail)) throw new AppError("El email no es válido.");
  const pw = passwordSchema().safeParse(i.adminPassword);
  if (!pw.success) throw new AppError(pw.error.issues[0]?.message ?? "Contraseña no válida.");
  return { orgName, adminName, adminEmail };
}

/**
 * Crea la instalación: ajustes en AppState, primer administrador y proyecto de ejemplo; borra el código.
 * Bajo un bloqueo de Postgres y con la comprobación «sin usuarios» dentro: dos finalizaciones a la vez
 * no pueden crear dos administradores.
 */
export async function completeSetup(db: PrismaClient, input: SetupInput, env: Record<string, string | undefined> = process.env): Promise<{ adminId: string }> {
  if (!(await isSetupPending(db, env))) throw new AppError("La instalación ya está configurada.", 404);
  if (!(await checkSetupCode(db, input.code, Date.now(), env))) throw new AppError("El código no es correcto o ha caducado.", 403);
  const { orgName, adminName, adminEmail } = validateSetupInput(input);
  const passwordHash = await hashPassword(input.adminPassword);
  const admin = await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${SETUP_LOCK})`;
    if ((await tx.user.count()) > 0) throw new AppError("La instalación ya está configurada.", 404);
    const set = (key: string, value: string) => tx.appState.upsert({ where: { key }, create: { key, value }, update: { value } });
    await set(INSTANCE_ORG_KEY, orgName);
    await set(INSTANCE_LOCALE_KEY, input.locale);
    await set(INSTANCE_TZ_KEY, input.timeZone);
    const created = await createInitialAdmin(tx, { email: adminEmail, name: adminName, passwordHash, locale: input.locale === "en" ? "EN" : "ES" });
    await tx.appState.deleteMany({ where: { key: SETUP_CODE_KEY } });
    return created;
  });
  doneForever = true;
  invalidateInstance();
  // Proyecto de ejemplo como con el seed por variables (ya hay administrador). Si falla, la instalación sigue siendo válida.
  await seed(db, () => {}).catch((err) => console.error("[setup] No se pudo crear el proyecto de ejemplo:", err));
  return { adminId: admin.id };
}
