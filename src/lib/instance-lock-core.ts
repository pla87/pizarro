// Parte pura del aviso de «otra copia de Pizarro usando esta misma base de datos» (instance-lock.ts): estados, reglas y
// el aviso que se muestra en Administración. Sin base de datos ni pg: se prueba sola (tests/instance-lock.test.ts).

/** Prefijo del application_name de la conexión del bloqueo: así se reconoce en pg_stat_activity a otra copia de Pizarro. */
export const INSTANCE_APP_NAME_PREFIX = "pizarro-instance:";
/** Cada cuánto se comprueba el bloqueo (y se intenta cogerlo si lo tiene otra copia). */
export const INSTANCE_CHECK_MS = 30_000;
/**
 * Cuánto puede durar otra copia con el bloqueo antes de avisar. En un despliegue de Railway sin volumen la versión nueva
 * arranca mientras la anterior sigue sirviendo y conviven unos segundos: eso no es un problema y no debe avisar.
 */
export const INSTANCE_CONFLICT_GRACE_MS = 2 * 60_000;
/** AppState donde la copia que no tiene el bloqueo deja constancia (así la otra, la que lo tiene, también lo muestra). */
export const INSTANCE_NOTICE_KEY = "instance.otherCopy";
/** Lo guardado deja de valer si nadie lo renueva en este tiempo (la otra copia ya se paró). */
export const INSTANCE_NOTICE_TTL_MS = 3 * INSTANCE_CHECK_MS;

/**
 * Estado del bloqueo en este proceso. «waiting»: otra copia lo tiene desde `since` (aún dentro del margen); «conflict»: ya
 * pasó el margen. «pooler»: la conexión pasa por un PgBouncer en modo transacción (los bloqueos de sesión no son fiables
 * ahí), así que no se comprueba nada. «error»: no se pudo comprobar (la base no responde); no avisa.
 */
export type InstanceLockStatus =
  | { status: "starting" }
  | { status: "held"; since: number }
  | { status: "waiting"; since: number; holderSince: string | null }
  | { status: "conflict"; since: number; holderSince: string | null }
  | { status: "pooler" }
  | { status: "error"; message: string };

/** Lo que dijo PostgreSQL en una comprobación. */
export type LockAttempt =
  | { kind: "acquired" }
  /** Lo tiene otra sesión: su application_name y desde cuándo está conectada (null si no se ve o ya lo soltó). */
  | { kind: "busy"; holder: { appName: string | null; since: string | null } | null }
  /** Lo teníamos y nuestra sesión ya no lo tiene (o es otra sesión): un pooler en modo transacción reparte las consultas. */
  | { kind: "lost" }
  | { kind: "error"; message: string };

/** ¿Dice la cadena de conexión que pasa por PgBouncer (`pgbouncer=true`, la marca que pide Prisma)? */
export function poolerInUrl(url: string | undefined): boolean {
  try {
    return /^(1|true)$/i.test(new URL(url ?? "").searchParams.get("pgbouncer") ?? "");
  } catch {
    return false;
  }
}

/** Siguiente estado tras una comprobación. `own`: el application_name de la conexión de este proceso. */
export function nextLockStatus(prev: InstanceLockStatus, attempt: LockAttempt, now: number, own: string, graceMs = INSTANCE_CONFLICT_GRACE_MS): InstanceLockStatus {
  if (prev.status === "pooler") return prev;
  switch (attempt.kind) {
    case "acquired":
      return prev.status === "held" ? prev : { status: "held", since: now };
    case "lost":
      return { status: "pooler" };
    case "error":
      return { status: "error", message: attempt.message };
    case "busy": {
      const name = attempt.holder?.appName;
      // Lo tiene una sesión que no es de otra copia de Pizarro: con conexión directa no puede pasar (la clave es solo
      // nuestra), así que es una conexión de un pooler que guarda el bloqueo de una copia anterior (o la nuestra en otra
      // conexión del pooler). No se puede comprobar nada: no avisa.
      if (name === own || (typeof name === "string" && !name.startsWith(INSTANCE_APP_NAME_PREFIX))) return { status: "pooler" };
      const since = prev.status === "waiting" || prev.status === "conflict" ? prev.since : now;
      const holderSince = attempt.holder?.since ?? (prev.status === "waiting" || prev.status === "conflict" ? prev.holderSince : null);
      return { status: now - since >= graceMs ? "conflict" : "waiting", since, holderSince };
    }
  }
}

/** Lo que guarda en AppState la copia que avisa: cuándo lo comprobó por última vez y desde cuándo dura. */
interface StoredNotice {
  at: string;
  since: string;
}

export function parseStoredNotice(value: string | null | undefined): StoredNotice | null {
  if (!value) return null;
  try {
    const v = JSON.parse(value) as Partial<StoredNotice>;
    return typeof v.at === "string" && typeof v.since === "string" && !Number.isNaN(Date.parse(v.at)) && !Number.isNaN(Date.parse(v.since)) ? { at: v.at, since: v.since } : null;
  } catch {
    return null;
  }
}

/**
 * Aviso de Administración: hay otra copia usando la base desde `since` (ISO). Lo ve este proceso (no consigue el
 * bloqueo desde hace más del margen) o lo dejó guardado la otra copia hace poco (este proceso es el que lo tiene).
 */
export function otherInstanceNotice(local: InstanceLockStatus, stored: StoredNotice | null, now: number): { since: string } | null {
  if (local.status === "conflict") return { since: new Date(local.since).toISOString() };
  if (local.status === "pooler" || !stored) return null;
  return now - Date.parse(stored.at) < INSTANCE_NOTICE_TTL_MS ? { since: stored.since } : null;
}

/** Estado del bloqueo en este proceso, en globalThis: instrumentation.ts, las páginas y el diagnóstico son paquetes distintos. */
interface InstanceLockProcess {
  current: InstanceLockStatus;
  started: boolean;
}

export function instanceLockProcess(): InstanceLockProcess {
  return ((globalThis as unknown as { __pzInstanceLock?: InstanceLockProcess }).__pzInstanceLock ??= { current: { status: "starting" }, started: false });
}

/** Estado del bloqueo en este proceso (Administración y diagnóstico). Sin el servidor en marcha, «starting». */
export function instanceLockStatus(): InstanceLockStatus {
  return instanceLockProcess().current;
}
