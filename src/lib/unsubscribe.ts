import "server-only";
import { db } from "./db";
import { logEvent } from "./log";
import { appUrl } from "./mail";
import { maskEmail } from "./mask-email";
import {
  EMAIL_PREF_FIELD, parseUnsubscribeToken, unsubscribeHeaders, unsubscribeSignatureOk, unsubscribeToken, type UnsubscribeKind,
} from "./unsubscribe-core";

// Baja en un clic (RFC 8058) de los emails de avisos, del resumen diario y del informe semanal. Los emails llevan las
// cabeceras List-Unsubscribe (POST a /api/unsubscribe/<token>, sin sesión) y un enlace al pie a /unsubscribe/<token>, una
// página que pide confirmar con un botón: abrir un enlace nunca da de baja (los escáneres de enlaces de los gestores de
// correo los abren todos). Los emails de cuentas (invitación, restablecer, códigos, avisos de seguridad) no llevan baja.

/** Enlace del pie (página de confirmación) y cabeceras de la baja en un clic para un email de `kind` a `email`. */
export function unsubscribeLinks(kind: UnsubscribeKind, id: string, email: string): { page: string; headers: Record<string, string> } {
  const token = unsubscribeToken(kind, id, email);
  return { page: `${appUrl()}/unsubscribe/${token}`, headers: unsubscribeHeaders(`${appUrl()}/api/unsubscribe/${token}`) };
}

/** Lo que apaga un enlace de baja válido. `receiving`: si ese email sigue activado ahora. */
export interface UnsubscribeTarget {
  kind: UnsubscribeKind;
  /** Persona (avisos y resumen) o proyecto (informe semanal). */
  id: string;
  /** Solo en el informe: el nombre del proyecto, para decir cuál. */
  projectName: string | null;
  receiving: boolean;
  /** Dirección de destino (no se muestra: solo va enmascarada al registro). */
  email: string;
  userName: string | null;
}

/** Comprueba el token (forma y firma contra el email actual) y dice qué apaga, o null si no vale. */
export async function resolveUnsubscribe(token: string): Promise<UnsubscribeTarget | null> {
  const parsed = parseUnsubscribeToken(token);
  if (!parsed) return null;
  if (parsed.kind === "report") {
    const s = await db.reportSchedule.findUnique({ where: { projectId: parsed.id }, select: { recipient: true, enabled: true, project: { select: { name: true } } } });
    if (!s || !unsubscribeSignatureOk(parsed, s.recipient)) return null;
    return { kind: "report", id: parsed.id, projectName: s.project.name, receiving: s.enabled, email: s.recipient, userName: null };
  }
  const field = EMAIL_PREF_FIELD[parsed.kind];
  const u = await db.user.findUnique({ where: { id: parsed.id }, select: { name: true, email: true, notifyEmail: true, notifyAssignedEmail: true, notifyDueEmail: true, notifyCommentEmail: true, dailyDigest: true } });
  if (!u || !unsubscribeSignatureOk(parsed, u.email)) return null;
  return { kind: parsed.kind, id: parsed.id, projectName: null, receiving: u[field], email: u.email, userName: u.name };
}

/**
 * Da de baja el email del token (solo ese tipo). Devuelve qué ha apagado (`changed` falso si ya estaba apagado) o null
 * si el token no vale. `via`: «one-click» (el gestor de correo) o «page» (el botón de la página).
 */
export async function applyUnsubscribe(token: string, via: "one-click" | "page", ip: string): Promise<(UnsubscribeTarget & { changed: boolean }) | null> {
  const target = await resolveUnsubscribe(token);
  if (!target) return null;
  let changed: boolean;
  if (target.kind === "report") {
    // Solo si sigue yendo a la misma dirección (otra persona pudo cambiar el destinatario entre medias).
    const r = await db.reportSchedule.updateMany({ where: { projectId: target.id, enabled: true, recipient: target.email }, data: { enabled: false } });
    changed = r.count > 0;
  } else {
    const field = EMAIL_PREF_FIELD[target.kind];
    const r = await db.user.updateMany({ where: { id: target.id, email: target.email, [field]: true }, data: { [field]: false } });
    changed = r.count > 0;
  }
  if (changed) {
    logEvent({
      category: "notify", action: "notify.unsubscribed",
      message: target.kind === "report"
        ? `Informe semanal de «${target.projectName}» dado de baja por su destinatario (${maskEmail(target.email)}) desde el enlace del email`
        : `${target.userName} se ha dado de baja de los emails «${target.kind}» desde el enlace del email`,
      ip,
      ...(target.kind === "report" ? { projectId: target.id } : { userId: target.id, userName: target.userName ?? undefined }),
      details: { kind: target.kind, via, to: maskEmail(target.email) },
    });
  }
  return { ...target, receiving: false, changed };
}
