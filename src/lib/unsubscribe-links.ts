import "server-only";
import { appUrl } from "./mail";
import { unsubscribeHeaders, unsubscribeToken, type UnsubscribeKind } from "./unsubscribe-core";

// Enlaces de la baja en un clic que llevan los emails (lib/unsubscribe.ts hace la baja). Aparte para que los módulos que
// envían emails (notify.ts, periodic-mail.ts, auth-mail.ts) no importen unsubscribe.ts, que a su vez avisa con notify.ts.

/** Enlace del pie (página de confirmación) y cabeceras de la baja en un clic para un email de `kind` a `email`. */
export function unsubscribeLinks(kind: UnsubscribeKind, id: string, email: string): { page: string; headers: Record<string, string> } {
  const token = unsubscribeToken(kind, id, email);
  return { page: `${appUrl()}/unsubscribe/${token}`, headers: unsubscribeHeaders(`${appUrl()}/api/unsubscribe/${token}`) };
}
