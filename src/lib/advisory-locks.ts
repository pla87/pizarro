// Claves numéricas de los bloqueos consultivos de PostgreSQL (pg_advisory_lock y pg_advisory_xact_lock), todas aquí
// para que no se repitan: dos usos con la misma clave se excluyen entre sí sin tener nada que ver (pasó con el correo
// programado y el reparto de exportaciones, que compartían 741_031_003). `tests/advisory-locks.test.ts` comprueba que
// son distintas y que ningún otro fichero define las suyas. Sin dependencias: lo importan también los scripts.
//
// Los bloqueos por nombre usan `hashtext('<prefijo>:…')` (columnas de un proyecto, cupo de adjuntos, tipos de tarea…):
// van con un prefijo propio en el sitio que los usa y no necesitan número.
//
// Una clave no se cambia a la ligera: durante un despliegue conviven el proceso viejo y el nuevo, y con claves
// distintas no se excluyen hasta que el viejo se apaga.

/** Asistente de primer arranque: dos finalizaciones a la vez no crean dos administradores (setup.ts). */
export const LOCK_SETUP = 727_274_001;
/** Pasada horaria de mantenimiento (copias, limpieza…): un solo proceso a la vez (maintenance.ts). */
export const LOCK_MAINTENANCE = 741_031_001;
/** Reanudar las releases que se quedaron a medias (maintenance.ts). */
export const LOCK_RELEASE_RESUME = 741_031_002;
/** Reparto de exportaciones e importaciones de proyectos en cola (transfer-jobs.ts). */
export const LOCK_TRANSFER_CLAIM = 741_031_003;
/** Correo programado (resúmenes y recordatorios), aparte del mantenimiento (maintenance.ts). Antes 741_031_003. */
export const LOCK_MAIL = 741_031_004;
/** Crear una copia de seguridad o subirla al destino externo: un solo proceso a la vez (backup.ts). */
export const LOCK_BACKUP = 741_031_005;

/**
 * Nombre del bloqueo de las columnas de un proyecto (para `pg_advisory_xact_lock(hashtext(…))`): crear, borrar y deshacer
 * la creación de una columna lo toman dentro de su transacción, así dos a la vez no pasan del tope ni dejan el
 * proyecto sin columnas.
 */
export function columnsLockName(projectId: string): string {
  return `columns:${projectId}`;
}

/** Todas, con su nombre (para la prueba de que no se repiten). */
export const ADVISORY_LOCKS: Readonly<Record<string, number>> = {
  LOCK_SETUP,
  LOCK_MAINTENANCE,
  LOCK_RELEASE_RESUME,
  LOCK_TRANSFER_CLAIM,
  LOCK_MAIL,
  LOCK_BACKUP,
};
