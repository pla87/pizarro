import "server-only";
import { COMMENT_LIMIT_KEY } from "./app-settings";
import { appStateVersion } from "./edit-conflict";
import { INSTANCE_LOCALE_KEY, INSTANCE_ORG_KEY, INSTANCE_TZ_KEY } from "./instance-core";
import { QUOTA_PROJECT_KEY, QUOTA_TOTAL_KEY } from "./quota-settings";

// Claves de AppState de cada formulario de Administración → Ajustes: su versión (edit-conflict.ts) avisa si otro
// administrador guardó el mismo formulario mientras se editaba.

export const INSTANCE_KEYS = [INSTANCE_ORG_KEY, INSTANCE_LOCALE_KEY, INSTANCE_TZ_KEY] as const;
export const COMMENT_LIMIT_KEYS = [COMMENT_LIMIT_KEY] as const;
export const QUOTA_KEYS = [QUOTA_PROJECT_KEY, QUOTA_TOTAL_KEY] as const;

/** Versiones de los formularios de Ajustes, para la página. */
export async function settingsVersions(): Promise<{ installation: string; comments: string; storage: string }> {
  const [installation, comments, storage] = await Promise.all([appStateVersion(INSTANCE_KEYS), appStateVersion(COMMENT_LIMIT_KEYS), appStateVersion(QUOTA_KEYS)]);
  return { installation, comments, storage };
}
