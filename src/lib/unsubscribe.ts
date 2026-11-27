import "server-only";
import { db } from "./db";
import { logEvent } from "./log";
import { maskEmail } from "./mask-email";
import { notifyReportUnsubscribed } from "./notify";
import { noteMentionEmailMode } from "./note-mention-pref";
import { EMAIL_PREF_FIELD, parseUnsubscribeToken, unsubscribeSignatureOk, type UnsubscribeKind } from "./unsubscribe-core";

// Baja en un clic (RFC 8058) de los emails de avisos, del resumen diario y del informe semanal. Los emails llevan las
// cabeceras List-Unsubscribe (POST a /api/unsubscribe/<token>, sin sesión) y un enlace al pie a /unsubscribe/<token>, una
// página que pide confirmar con un botón: abrir un enlace nunca da de baja (los escáneres de enlaces de los gestores de
// correo los abren todos). Los emails de cuentas (invitación, restablecer, códigos, avisos de seguridad) no llevan baja.
// Los enlaces de los emails los compone unsubscribe-links.ts.

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
  /** Idioma de la persona (avisos y resumen); null en el informe, que va a una dirección sin cuenta. */
  locale: string | null;
}

/** Comprueba el token (forma y firma contra el email actual) y dice qué apaga, o null si no vale. */
export async function resolveUnsubscribe(token: string): Promise<UnsubscribeTarget | null> {
  const parsed = parseUnsubscribeToken(token);
  if (!parsed) return null;
  if (parsed.kind === "report") {
    const s = await db.reportSchedule.findUnique({ where: { projectId: parsed.id }, select: { recipient: true, enabled: true, project: { select: { name: true } } } });
    if (!s || !unsubscribeSignatureOk(parsed, s.recipient)) return null;
    return { kind: "report", id: parsed.id, projectName: s.project.name, receiving: s.enabled, email: s.recipient, userName: null, locale: null };
  }
  const u = await db.user.findUnique({ where: { id: parsed.id }, select: { name: true, locale: true, email: true, notifyEmail: true, notifyAssignedEmail: true, notifyDueEmail: true, notifyCommentEmail: true, dailyDigest: true, noteMentionEmail: true } });
  if (!u || !unsubscribeSignatureOk(parsed, u.email)) return null;
  // Menciones en notas: las recibe mientras la opción no esté en «No» (al momento o en el resumen).
  const receiving = parsed.kind === "note" ? noteMentionEmailMode(u) !== "OFF" : u[EMAIL_PREF_FIELD[parsed.kind]];
  return { kind: parsed.kind, id: parsed.id, projectName: null, receiving, email: u.email, userName: u.name, locale: u.locale };
}

/**
 * Da de baja el email del token (solo ese tipo). Devuelve qué ha apagado (`changed` falso si ya estaba apagado) o null
 * si el token no vale. `via`: «one-click» (el gestor de correo) o «page» (el botón de la página).
 */
export async function applyUnsubscribe(token: string, via: "one-click" | "page", ip: string): Promise<(UnsubscribeTarget & { changed: boolean }) | null> {
  const target = await resolveUnsubscribe(token);
  if (!target) return null;
  let changed: boolean;
  let reportSetterId: string | null = null;
  if (target.kind === "report") {
    // Solo si sigue yendo a la misma dirección (otra persona pudo cambiar el destinatario entre medias). Se apunta quién
    // se dio de baja y cuándo: Ajustes del proyecto → Informes lo muestra y no deja reactivarlo hacia esa dirección salvo
    // a esa misma persona (saveReportSchedule).
    const unsubscribed = { unsubscribedEmail: target.email, unsubscribedAt: new Date() };
    const off = await db.reportSchedule.updateManyAndReturn({
      where: { projectId: target.id, enabled: true, recipient: target.email },
      data: { enabled: false, ...unsubscribed },
      select: { createdById: true },
    });
    changed = off.length > 0;
    reportSetterId = off[0]?.createdById ?? null;
    // Ya desactivado (alguien lo apagó entre medias): no deja de salir nada, pero se apunta igual la baja, para que nadie
    // lo vuelva a activar hacia esa dirección sin saberlo.
    if (!changed) {
      await db.reportSchedule.updateMany({
        where: { projectId: target.id, recipient: target.email, OR: [{ unsubscribedEmail: null }, { NOT: { unsubscribedEmail: { equals: target.email, mode: "insensitive" } } }] },
        data: unsubscribed,
      });
    }
  } else if (target.kind === "note") {
    // Solo si aún las recibe (receiving se calculó con el valor de entonces); «No» por escrito, aunque viniera de serie.
    const r = target.receiving ? await db.user.updateMany({ where: { id: target.id, email: target.email, OR: [{ noteMentionEmail: null }, { noteMentionEmail: { not: "OFF" } }] }, data: { noteMentionEmail: "OFF" } }) : { count: 0 };
    changed = r.count > 0;
  } else {
    const field = EMAIL_PREF_FIELD[target.kind];
    const r = await db.user.updateMany({ where: { id: target.id, email: target.email, [field]: true }, data: { [field]: false } });
    changed = r.count > 0;
  }
  if (changed) {
    logEvent({
      category: "notify", action: "notify.unsubscribed",
      label: target.kind === "report"
        ? { k: "Informe semanal de «{project}» dado de baja por su destinatario ({to}) desde el enlace del email", p: { project: String(target.projectName), to: maskEmail(target.email) } }
        : { k: "{name} se ha dado de baja de los emails «{kind}» desde el enlace del email", p: { name: String(target.userName), kind: target.kind } },
      ip,
      ...(target.kind === "report" ? { projectId: target.id } : { userId: target.id, userName: target.userName ?? undefined }),
      details: { kind: target.kind, via, to: maskEmail(target.email) },
    });
  }
  // Aviso a quien lo configuró (salvo que sea la misma persona que se ha dado de baja). Un fallo no deshace la baja.
  if (changed && reportSetterId) {
    const setter = await db.user.findUnique({ where: { id: reportSetterId }, select: { email: true } });
    if (setter && setter.email.toLowerCase() !== target.email.toLowerCase()) {
      await notifyReportUnsubscribed(target.id, reportSetterId, await unsubscriberLabel(target.email)).catch((err) => console.error("[unsubscribe] aviso", err));
    }
  }
  return { ...target, receiving: false, changed };
}

/** Quién se ha dado de baja del informe, para el aviso: su nombre si tiene cuenta o, si no, su dirección enmascarada. */
async function unsubscriberLabel(email: string): Promise<string> {
  const person = await db.user.findFirst({ where: { email: { equals: email, mode: "insensitive" } }, select: { name: true } });
  return person?.name ?? maskEmail(email);
}
