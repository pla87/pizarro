import "server-only";
import { trackInFlight } from "./shutdown";
import { after } from "next/server";
import type { Prisma } from "@/generated/prisma/client";
import { intlLocale, makeT, toLocale, type Locale, type T } from "../i18n/core";
import { projectUsersWhere } from "./access";
import { actionContext } from "./action-context";
import { db } from "./db";
import { appUrl, emailEnabled, escapeHtml, noReplyNote, sendMail, unsubscribeFooter } from "./mail";
import { ellipsize } from "./graphemes";
import { logEvent, logText } from "./log";
import { maskEmail, maskEmailsIn } from "./mask-email";
import { excerpt as makeExcerpt, extractMentionIds, mentionsToPlain } from "./mentions";
import { noteMentionEmailMode } from "./note-mention-pref";
import { noticeActorName, notificationHeadline, projectNoticeActor, projectNoticePath, quotesWriting, shareRevokedExcerpt, shareRevokedParts, type NotificationKind } from "./notification-text";
import { loadMessagingConfig, type MessagingConfig } from "./messaging-config";
import {
  CHANNEL_LIMIT_PER_HOUR, channelUsable, channelWants, classifyFailure, maskPhone, noticeBody, noticeLinkLabel, quoteIntro, scrubSecrets, telegramNoticeText, type ChannelPrefs, type NoticeMessage,
} from "./messaging-core";
import { disconnectTelegramChat, sendTelegramMessage } from "./telegram";
import { sendWhatsappNotice, whatsappLocale } from "./whatsapp";
import { followerIds } from "./followers";
import { rateLimit, releaseRateLimit } from "./rate-limit";
import { reserveWhatsappNotice } from "./whatsapp-quota";
import { EMAIL_PREF_FIELD, noticeEmailKind } from "./unsubscribe-core";
import { unsubscribeLinks } from "./unsubscribe-links";

// Avisos (menciones, asignaciones, cambios de fecha, comentarios y respuestas): en la app (tabla Notification), por
// email (SMTP) y por los canales que cada persona conecta en Mi perfil → Avisos (Telegram y WhatsApp, si el
// administrador los ha activado en Administración → Integraciones). Los envíos externos se hacen tras responder al usuario
// (after), para que avisar no añada espera.

export { emailEnabled };

/** Datos de un aviso para el email y los mensajes (mismo contenido en todos los canales). */
type MentionMessage = NoticeMessage;

/**
 * Email de un aviso: asunto, texto plano y HTML (todo el contenido del usuario va escapado). Lo que ha escrito una
 * persona (comentario, respuesta, texto con la mención) va como cita suya: «Ana ha escrito:» y el extracto en un bloque
 * de cita, separado de la cabecera, para que un nombre o un texto no pueda pasar por un mensaje de Pizarro.
 * `unsubscribeUrl`: el enlace del pie para dejar de recibir este tipo de aviso (lib/unsubscribe.ts).
 */
export function mentionEmail(m: MentionMessage, t: T = makeT("es"), opts: { unsubscribeUrl?: string } = {}) {
  const type = m.type ?? "MENTION";
  // Sin repetir el título en una asignación (ya va en el asunto y en la cabecera).
  const body = noticeBody(m, t);
  const quoted = body !== "" && quotesWriting(type);
  // Las comillas del título van en la plantilla traducida: «…» en español, “…” en inglés. Recortado como en Telegram y
  // WhatsApp: un título de cientos de caracteres no cabe en el asunto (muchos programas lo cortan o lo parten).
  const task = t("«{title}»", { title: ellipsize(m.taskTitle.replace(/\s+/g, " ").trim(), 120) });
  const subject = notificationHeadline(type, t, { actor: m.actorName, task, excerpt: m.excerpt, note: m.note });
  const open = noticeLinkLabel(m, t);
  const optOut = t("Puedes desactivar estos avisos en «Mi perfil» de Pizarro.");
  const noReply = noReplyNote(t);
  const unsub = unsubscribeFooter(opts.unsubscribeUrl, t);
  const intro = quoted ? quoteIntro(m, t) : "";
  const bodyText = !body ? "" : quoted ? `\n\n${intro}\n${body.split("\n").map((l) => `> ${l}`).join("\n")}` : `:\n\n${body}`;
  const text = `${subject} (${m.projectName})${bodyText}\n\n${open}: ${m.url}\n\n${optOut}\n${unsub.text}${noReply}\n`;
  // Todo lo que viene de una persona va escapado en el HTML, también la columna de SHARE_REVOKED (sale del extracto).
  const column = type === "SHARE_REVOKED" ? escapeHtml(shareRevokedParts(m.excerpt).column) : undefined;
  const headline = notificationHeadline(type, t, { actor: `<strong>${escapeHtml(m.actorName)}</strong>`, task: `<strong>${escapeHtml(task)}</strong>`, excerpt: m.excerpt, column, note: m.note });
  const quote = `<blockquote style="margin:${quoted ? "4px" : "12px"} 0 12px;padding:8px 12px;border-left:4px solid #6366f1;background:#f8fafc;color:#334155">${escapeHtml(body)}</blockquote>`;
  const html = `<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;font-size:15px;color:#0f172a;max-width:560px">
<p>${headline} · ${escapeHtml(m.projectName)}</p>
${quoted ? `<p style="margin:12px 0 0;color:#475569">${escapeHtml(intro)}</p>\n` : ""}${body ? quote : ""}
<p><a href="${escapeHtml(m.url)}" style="display:inline-block;background:#4f46e5;color:#fff;padding:9px 16px;border-radius:8px;text-decoration:none">${escapeHtml(open)}</a></p>
<p style="color:#64748b;font-size:12px">${escapeHtml(optOut)}<br>${escapeHtml(noReply)}${unsub.html}</p></div>`;
  return { subject, text, html };
}

/**
 * Datos de un aviso de proyecto (PROJECT_TO_TEAM, REPORT_UNSUBSCRIBED) para el email y los mensajes: el proyecto ocupa
 * el lugar de la tarea y el extracto (la cuenta borrada o quien se dio de baja), el del autor.
 */
function projectNoticeMessage(n: { type: NotificationKind; excerpt: string; project: { id: string; name: string } }, locale: Locale, t: T): MentionMessage {
  return {
    type: n.type,
    locale: intlLocale(locale),
    actorName: projectNoticeActor(n.type, n.excerpt) || t("Usuario eliminado"),
    taskTitle: n.project.name,
    projectName: n.project.name,
    excerpt: n.excerpt,
    url: `${appUrl()}${projectNoticePath(n.type, n.project.id)}`,
  };
}

/**
 * ¿Quiere esta persona el email de este tipo de aviso? (en la app se crean siempre). Grupos en noticeEmailKind: los
 * recordatorios de «Esperando» van con las fechas límite (como en Telegram y WhatsApp, channelWants; hasta la v1.63
 * salían con «Avisos de menciones») y los de administración (un proyecto pasa a ser de equipo), con las menciones.
 */
export function emailWanted(type: NotificationKind, u: { notifyEmail: boolean; notifyAssignedEmail: boolean; notifyDueEmail: boolean; notifyCommentEmail: boolean }): boolean {
  return u[EMAIL_PREF_FIELD[noticeEmailKind(type)]];
}

/**
 * ¿Puede salir este aviso por fuera ahora? Email solo con el correo configurado en la instalación (emailEnabled) y
 * Telegram/WhatsApp solo si están activados y conectados (channelsFor). Es lo que cuenta «con envío externo» en Logs:
 * sin email ni canales, las preferencias de la persona (el email de menciones viene activado) no cuentan.
 */
function externalWanted(type: NotificationKind, u: Parameters<typeof emailWanted>[1] & { channels: ChannelRow[] }, cfg: MessagingConfig): boolean {
  return (emailEnabled() && emailWanted(type, u)) || channelsFor(type, u.channels, cfg).length > 0;
}

const CHANNEL_SELECT = { channel: true, address: true, verifiedAt: true, consentAt: true, notifyMention: true, notifyAssigned: true, notifyDue: true, notifyComment: true } as const;
type ChannelRow = { channel: "TELEGRAM" | "WHATSAPP"; address: string; verifiedAt: Date | null; consentAt: Date | null } & ChannelPrefs;

/** Canales por los que puede salir este aviso ahora: activados por el administrador, conectados y queridos para este tipo. */
function channelsFor(type: NotificationKind, channels: ChannelRow[], cfg: MessagingConfig): ChannelRow[] {
  return channels.filter((ch) =>
    (ch.channel === "TELEGRAM" ? cfg.telegram.active : cfg.whatsapp.active) && channelUsable(ch, type, cfg.whatsapp.legacy) && channelWants(type, ch));
}

/** Envía por email, Telegram y WhatsApp los avisos indicados (tras responder). Exportada para los tests. */
export async function deliver(notificationIds: string[]): Promise<void> {
  if (!notificationIds.length) return;
  const messaging = await loadMessagingConfig();
  if (!emailEnabled() && !messaging.telegram.active && !messaging.whatsapp.active) return;
  const rows = await db.notification.findMany({
    where: { id: { in: notificationIds } },
    select: {
      id: true,
      type: true,
      excerpt: true,
      user: { select: { id: true, name: true, email: true, locale: true, active: true, notifyEmail: true, notifyAssignedEmail: true, notifyDueEmail: true, notifyCommentEmail: true, dailyDigest: true, noteMentionEmail: true, channels: { select: CHANNEL_SELECT } } },
      actor: { select: { name: true } },
      task: { select: { id: true, title: true, project: { select: { id: true, name: true, isPrivate: true } } } },
      project: { select: { id: true, name: true, isPrivate: true } },
      document: { select: { id: true, name: true, deletedAt: true, project: { select: { id: true, name: true, isPrivate: true } } } },
    },
  });
  /** Proyecto del aviso: el de su tarea, el de su nota o, en un aviso de proyecto, el suyo. */
  const projectOf = (n: (typeof rows)[number]) => n.task?.project ?? n.document?.project ?? n.project;
  // El envío sale después de crear el aviso: se vuelve a comprobar que cada persona sigue pudiendo ver el
  // proyecto (p. ej. la han sacado de un proyecto privado entre medias). Si no, no sale nada por fuera.
  const allowed = new Set<string>();
  const byProject = new Map<string, { isPrivate: boolean; userIds: string[] }>();
  for (const n of rows) {
    const project = projectOf(n);
    if (!project) continue;
    const entry = byProject.get(project.id) ?? { isPrivate: project.isPrivate, userIds: [] };
    entry.userIds.push(n.user.id);
    byProject.set(project.id, entry);
  }
  for (const [projectId, { isPrivate, userIds }] of byProject) {
    const ok = await db.user.findMany({ where: mentionRecipientsWhere({ isPrivate }, userIds, projectId), select: { id: true } });
    for (const u of ok) allowed.add(`${projectId}:${u.id}`);
  }
  for (const n of rows) {
    const project = projectOf(n);
    if (!project || !n.user.active) continue;
    const taskId = n.task?.id ?? null;
    if (!allowed.has(`${project.id}:${n.user.id}`)) {
      logEvent({ category: "notify", action: "notify.skippedNoAccess", label: { k: "Envío externo omitido: {name} ya no tiene acceso al proyecto", p: { name: n.user.name } }, userId: n.user.id, userName: n.user.name, projectId: project.id, details: { notificationId: n.id, taskId } });
      continue;
    }
    const locale = toLocale(n.user.locale);
    const t = makeT(locale);
    // Mención en una nota: solo por email y solo con «Al momento» (Telegram y WhatsApp no; el resumen la recoge aparte).
    if (n.document) {
      await deliverNoteMention({ ...n, document: n.document }, project, locale, t);
      continue;
    }
    const msg: MentionMessage = n.task
      ? {
          type: n.type,
          locale: intlLocale(locale),
          actorName: noticeActorName(n.actor?.name, n.excerpt, t("Alguien")),
          taskTitle: mentionsToPlain(n.task.title),
          projectName: project.name,
          excerpt: n.excerpt,
          url: `${appUrl()}/p/${project.id}?task=${n.task.id}`,
        }
      : // Aviso de proyecto: en la cabecera va el proyecto (en lugar de la tarea) y la cuenta borrada (el extracto).
        projectNoticeMessage({ type: n.type, excerpt: n.excerpt, project }, locale, t);
    const update: { emailSentAt?: Date; whatsappSentAt?: Date; telegramSentAt?: Date; deliveryError?: string } = {};
    const errors: string[] = [];
    const base = { category: "notify", userId: n.user.id, userName: n.user.name, projectId: project.id };
    if (emailEnabled() && emailWanted(n.type, n.user)) {
      const t0 = performance.now();
      try {
        // Con su enlace de baja (solo este grupo de avisos) y las cabeceras de la baja en un clic.
        const unsub = unsubscribeLinks(noticeEmailKind(n.type), n.user.id, n.user.email);
        await sendMail({ to: n.user.email, ...mentionEmail(msg, t, { unsubscribeUrl: unsub.page }), headers: unsub.headers });
        update.emailSentAt = new Date();
        logEvent({ ...base, action: "notify.email", label: { k: "Email de aviso ({type}) enviado a {name}", p: { type: n.type, name: n.user.name } }, durationMs: performance.now() - t0, details: { notificationId: n.id, taskId, to: maskEmail(n.user.email) } });
      } catch (err) {
        errors.push(`email: ${(err as Error).message}`);
        logEvent({ ...base, level: "error", action: "notify.emailFailed", label: { k: "Fallo al enviar email a {name}: {error}", p: { name: n.user.name, error: logText(maskEmailsIn((err as Error).message)) } }, durationMs: performance.now() - t0, details: { notificationId: n.id, taskId, to: maskEmail(n.user.email) } });
      }
    }
    for (const ch of channelsFor(n.type, n.user.channels, messaging)) {
      const name = ch.channel === "TELEGRAM" ? "Telegram" : "WhatsApp";
      const key = ch.channel === "TELEGRAM" ? "telegram" : "whatsapp";
      const details = { notificationId: n.id, taskId, type: n.type, ...(ch.channel === "WHATSAPP" ? { to: maskPhone(ch.address) } : {}) };
      // Tope por persona y canal: una avalancha de avisos no se convierte en una avalancha de mensajes (ni de gasto).
      if (!rateLimit(`notify:${key}:${n.user.id}`, CHANNEL_LIMIT_PER_HOUR[ch.channel], 60 * 60_000)) {
        if (rateLimit(`notify:${key}:${n.user.id}:warned`, 1, 60 * 60_000)) logEvent({ ...base, level: "warn", action: `notify.${key}RateLimited`, label: { k: "Tope de {max} mensajes por hora de {channel} alcanzado para {name}: los siguientes avisos de esta hora solo quedan en la app", p: { max: CHANNEL_LIMIT_PER_HOUR[ch.channel], channel: name, name: n.user.name } }, details });
        continue;
      }
      // Tope diario de WhatsApp para toda la instalación (cuesta dinero): al llegar, este aviso no sale por WhatsApp (los
      // demás canales, igual) y queda una sola línea en Logs al día. No gasta el tope por persona.
      if (ch.channel === "WHATSAPP") {
        const quota = await reserveWhatsappNotice(messaging.whatsapp.dailyLimit);
        if (!quota.ok) {
          releaseRateLimit(`notify:${key}:${n.user.id}`);
          if (quota.firstBlocked) logEvent({ category: "notify", level: "warn", action: "notify.whatsappDailyLimit", label: { k: "Tope diario de {max} mensajes de WhatsApp alcanzado: hasta mañana, los avisos solo quedan en la app y en los demás canales", p: { max: messaging.whatsapp.dailyLimit } }, details: { day: quota.day, max: messaging.whatsapp.dailyLimit } });
          continue;
        }
      }
      const t0 = performance.now();
      try {
        if (ch.channel === "TELEGRAM") {
          await sendTelegramMessage(messaging.telegram.token, ch.address, telegramNoticeText(msg, t));
          update.telegramSentAt = new Date();
        } else {
          // Sin la plantilla en inglés, el aviso va entero en español (ver whatsappLocale).
          const waLocale = whatsappLocale(messaging.whatsapp, locale);
          const tw = waLocale === locale ? t : makeT(waLocale);
          const waMsg = waLocale === locale ? msg : n.task ? { ...msg, locale: intlLocale(waLocale), actorName: noticeActorName(n.actor?.name, n.excerpt, tw("Alguien")) } : projectNoticeMessage({ type: n.type, excerpt: n.excerpt, project }, waLocale, tw);
          await sendWhatsappNotice(messaging.whatsapp, ch.address, waMsg, tw, waLocale === "en");
          update.whatsappSentAt = new Date();
        }
        logEvent({ ...base, action: `notify.${key}`, label: { k: "{channel}: aviso ({type}) enviado a {name}", p: { channel: name, type: n.type, name: n.user.name } }, durationMs: performance.now() - t0, details });
      } catch (err) {
        const reason = scrubSecrets((err as Error).message, [messaging.telegram.token, messaging.whatsapp.token, ch.address]);
        errors.push(`${key}: ${reason}`);
        logEvent({ ...base, level: "error", action: `notify.${key}Failed`, label: { k: "Fallo al enviar {channel} a {name}: {error}", p: { channel: name, name: n.user.name, error: logText(reason) } }, durationMs: performance.now() - t0, details });
        // Telegram 403: la persona bloqueó el bot o borró el chat. Se desconecta para no seguir intentándolo.
        if (ch.channel === "TELEGRAM" && classifyFailure("TELEGRAM", err) === "disconnect") await disconnectTelegramChat(ch.address, "send-failed").catch(() => {});
      }
    }
    if (errors.length) {
      update.deliveryError = errors.join(" | ").slice(0, 500);
      console.error("[notify]", n.id, maskEmailsIn(update.deliveryError));
    }
    if (Object.keys(update).length) await db.notification.update({ where: { id: n.id }, data: update });
  }
}

/**
 * Email de una mención en una nota (deliver), si la persona lo quiere al momento (noteMentionEmailMode) y la nota sigue
 * fuera de la papelera. Lleva su propio enlace de baja («note»: pone la opción en «No»). Sin Telegram ni WhatsApp: el
 * texto de una nota se guarda solo cada pocos segundos y WhatsApp cuesta dinero; en la campana sale siempre.
 */
async function deliverNoteMention(
  n: { id: string; excerpt: string; actor: { name: string } | null; document: { id: string; name: string; deletedAt: Date | null }; user: { id: string; name: string; email: string; notifyEmail: boolean; dailyDigest: boolean; noteMentionEmail: string | null } },
  project: { id: string; name: string },
  locale: Locale,
  t: T,
): Promise<void> {
  if (!emailEnabled() || n.document.deletedAt || noteMentionEmailMode(n.user) !== "NOW") return;
  const msg: MentionMessage = {
    type: "MENTION",
    note: true,
    locale: intlLocale(locale),
    actorName: noticeActorName(n.actor?.name, n.excerpt, t("Alguien")),
    taskTitle: n.document.name,
    projectName: project.name,
    excerpt: n.excerpt,
    url: `${appUrl()}/p/${project.id}/docs?doc=${n.document.id}`,
  };
  const base = { category: "notify", userId: n.user.id, userName: n.user.name, projectId: project.id };
  const details = { notificationId: n.id, documentId: n.document.id, to: maskEmail(n.user.email) };
  const t0 = performance.now();
  try {
    const unsub = unsubscribeLinks("note", n.user.id, n.user.email);
    await sendMail({ to: n.user.email, ...mentionEmail(msg, t, { unsubscribeUrl: unsub.page }), headers: unsub.headers });
    await db.notification.update({ where: { id: n.id }, data: { emailSentAt: new Date() } });
    logEvent({ ...base, action: "notify.email", label: { k: "Email de mención en una nota enviado a {name}", p: { name: n.user.name } }, durationMs: performance.now() - t0, details });
  } catch (err) {
    const error = `email: ${(err as Error).message}`.slice(0, 500);
    console.error("[notify]", n.id, maskEmailsIn(error));
    await db.notification.update({ where: { id: n.id }, data: { deliveryError: error } }).catch(() => {});
    logEvent({ ...base, level: "error", action: "notify.emailFailed", label: { k: "Fallo al enviar email a {name}: {error}", p: { name: n.user.name, error: logText(maskEmailsIn((err as Error).message)) } }, durationMs: performance.now() - t0, details });
  }
}

/**
 * Avisos de las menciones NUEVAS de una nota de Documentación al guardarla (saveNoteRow): quien aparece en `after` y no
 * en `before`, sin quien escribe, activo y con acceso al proyecto. En la campana siempre (enlaza a la nota); por email
 * según su opción de Mi perfil (al momento, en el resumen diario o no). Para no avisar de más con el guardado automático
 * (cada pocos segundos), a la misma persona por la misma nota no se le crea otro aviso en 10 minutos (quitar y volver a
 * poner una mención mientras se escribe no avisa dos veces). El extracto es el párrafo de la mención. Devuelve a quién avisa.
 */
export async function notifyNoteMentions(opts: { actorId: string; documentId: string; projectId: string; before: string; after: string }): Promise<string[]> {
  const old = new Set(extractMentionIds(opts.before));
  const ids = extractMentionIds(opts.after).filter((id) => !old.has(id) && id !== opts.actorId);
  if (!ids.length) return [];
  const project = await db.project.findUnique({ where: { id: opts.projectId }, select: { isPrivate: true } });
  if (!project) return [];
  const people = await db.user.findMany({ where: mentionRecipientsWhere(project, ids, opts.projectId), select: { id: true, notifyEmail: true, dailyDigest: true, noteMentionEmail: true } });
  if (!people.length) return [];
  const recent = await db.notification.findMany({
    where: { documentId: opts.documentId, type: "MENTION", userId: { in: people.map((p) => p.id) }, createdAt: { gte: new Date(Date.now() - DEDUPE_MINUTES * 60_000) } },
    select: { userId: true },
  });
  const skip = new Set(recent.map((r) => r.userId));
  const fresh = people.filter((p) => !skip.has(p.id));
  if (!fresh.length) return [];
  const created = await db.notification.createManyAndReturn({
    data: fresh.map((p) => ({ userId: p.id, actorId: opts.actorId, documentId: opts.documentId, type: "MENTION" as const, excerpt: mentionContext(opts.after, p.id) })),
    select: { id: true, userId: true },
  });
  // Email al momento, con el tope por hora de quien escribe (como los demás avisos que provoca una persona).
  const now = new Set(fresh.filter((p) => noteMentionEmailMode(p) === "NOW").map((p) => p.id));
  const toDeliver = emailEnabled()
    ? created.filter((c) => now.has(c.userId) && rateLimit(`notify:${opts.actorId}`, MAX_EXTERNAL_PER_HOUR, 60 * 60_000)).map((c) => c.id)
    : [];
  logEvent({
    category: "notify", action: "notify.note_mention", label: { k: "{n} aviso(s) de mención en una nota creados ({external} por email al momento)", p: { n: created.length, external: toDeliver.length } },
    userId: opts.actorId, projectId: opts.projectId,
    details: { documentId: opts.documentId, recipients: created.map((c) => c.userId), skippedRecent: [...skip] },
  });
  if (toDeliver.length) {
    const send = () => deliver(toDeliver).catch((err) => console.error("[notify] envío", err));
    try {
      after(() => trackInFlight(send));
    } catch {
      // Fuera de una petición (pruebas, tareas de fondo) no hay `after`: se envía aquí mismo.
      await send();
    }
  }
  return created.map((c) => c.userId);
}

/** Extracto de una mención en una nota: el párrafo (o línea) donde está la primera mención de esa persona. */
function mentionContext(text: string, userId: string): string {
  for (const block of text.split(/\n\s*\n/)) {
    if (extractMentionIds(block).includes(userId)) return makeExcerpt(block);
  }
  return makeExcerpt(text);
}

/**
 * Quién puede recibir un aviso entre los mencionados: activos y con acceso al proyecto. Con un proyecto
 * privado, solo sus miembros (y solo los mencionados).
 */
export function mentionRecipientsWhere(project: { isPrivate: boolean }, ids: string[], projectId: string): Prisma.UserWhereInput {
  return {
    id: { in: ids },
    active: true,
    ...projectUsersWhere(project, projectId),
  };
}

/** Añade a la gente al seguimiento de la tarea sin tocar a quien ya figura (si dejó de seguirla, sigue sin seguirla). */
export async function followTask(taskId: string, userIds: string[]): Promise<void> {
  const ids = [...new Set(userIds)];
  if (!ids.length) return;
  await db.taskFollower.createMany({ data: ids.map((userId) => ({ taskId, userId })), skipDuplicates: true });
}

/** Quién sigue la tarea ahora mismo (creador, asignado y filas de seguimiento), sin los excluidos. */
export async function taskFollowerIds(taskId: string, exclude: string[] = []): Promise<string[]> {
  const task = await db.task.findUnique({ where: { id: taskId }, select: { createdById: true, assigneeId: true, followers: { select: { userId: true, muted: true } } } });
  if (!task) return [];
  return followerIds({ createdById: task.createdById, assigneeId: task.assigneeId, rows: task.followers }, exclude);
}

/**
 * Crea avisos de mención para los usuarios indicados que estén activos, no sean el autor
 * y puedan ver el proyecto. Devuelve a quién ha avisado. Quien es mencionado pasa a seguir la tarea.
 */
export async function notifyMentions(opts: {
  actorId: string;
  taskId: string;
  projectId: string;
  recipientIds: string[];
  text: string;
  /** Comentario en el que se menciona (para actualizar el aviso al editarlo o borrarlo). */
  commentId?: string;
}): Promise<string[]> {
  const n = await notifyTask({ type: "MENTION", actorId: opts.actorId, taskId: opts.taskId, projectId: opts.projectId, recipientIds: opts.recipientIds, excerpt: makeExcerpt(opts.text), commentId: opts.commentId });
  if (n.recipients.length) await followTask(opts.taskId, n.recipients);
  return n.recipients;
}

/**
 * Avisos que creó un comentario, para cambiar su extracto al editarlo, deshacer la edición o borrarlo. Los que llevan
 * `commentId` se localizan por él; los anteriores a esa columna, por la heurística de antes: del mismo autor, creados
 * en el primer minuto del comentario y con el extracto de su texto actual (`body`).
 */
export function commentNoticesWhere(c: { id: string; taskId: string; authorId: string | null; createdAt: Date; body: string }): Prisma.NotificationWhereInput {
  const legacy: Prisma.NotificationWhereInput[] = c.authorId
    ? [{
        commentId: null, taskId: c.taskId, actorId: c.authorId, type: { in: ["COMMENT", "REPLY", "MENTION"] }, excerpt: makeExcerpt(c.body),
        createdAt: { gte: c.createdAt, lte: new Date(c.createdAt.getTime() + 60_000) },
      }]
    : [];
  return { OR: [{ commentId: c.id }, ...legacy] };
}

/**
 * Crea avisos (en la app, siempre) del tipo indicado para quienes estén activos, no sean el autor y
 * puedan ver el proyecto (en uno privado, solo sus miembros). Devuelve los destinatarios.
 */
export async function notifyTask(opts: {
  type: NotificationKind;
  /** Quien provoca el aviso; null = el sistema (recordatorios), a quien no se excluye de los destinatarios. */
  actorId: string | null;
  taskId: string;
  projectId: string;
  recipientIds: string[];
  excerpt: string;
  /** Comentario que provoca el aviso (COMMENT, REPLY y MENTION de un comentario). */
  commentId?: string;
  /** Fuera de una petición (planificador): el envío externo se hace aquí mismo, sin `after`. */
  immediate?: boolean;
}): Promise<{ recipients: string[] }> {
  const ids = [...new Set(opts.recipientIds.filter((id) => id !== opts.actorId))];
  if (!ids.length) return { recipients: [] };
  const project = await db.project.findUnique({ where: { id: opts.projectId }, select: { isPrivate: true } });
  if (!project) return { recipients: [] };
  const recipients = await db.user.findMany({
    where: mentionRecipientsWhere(project, ids, opts.projectId),
    select: { id: true },
  });
  if (!recipients.length) return { recipients: [] };
  const created = await db.notification.createManyAndReturn({
    data: recipients.map((r) => ({ userId: r.id, actorId: opts.actorId, taskId: opts.taskId, type: opts.type, excerpt: opts.excerpt, commentId: opts.commentId ?? null })),
    select: { id: true, userId: true },
  });
  const createdIds = created.map((c) => c.id);
  // Por email, Telegram o WhatsApp solo si la persona lo quiere para este tipo (lo decide deliver).
  const external = await externalAllowed(opts.actorId, opts.type, opts.taskId, created.map((c) => c.userId), createdIds);
  logEvent({
    category: "notify", action: `notify.${opts.type.toLowerCase()}`, label: { k: "{n} aviso(s) {type} creados ({external} con envío externo)", p: { n: createdIds.length, type: opts.type, external: external.size } },
    userId: opts.actorId ?? undefined, projectId: opts.projectId,
    details: { taskId: opts.taskId, recipients: created.map((c) => c.userId), externalRecipients: [...external] },
  });
  const toDeliver = created.filter((c) => external.has(c.userId)).map((c) => c.id);
  if (toDeliver.length) {
    const send = () => deliver(toDeliver).catch((err) => console.error("[notify] envío", err));
    if (opts.immediate) await send();
    else after(() => trackInFlight(send));
  }
  return { recipients: created.map((c) => c.userId) };
}

/** Ventana en la que no se repite email/Telegram/WhatsApp a la misma persona por la misma tarea. */
const DEDUPE_MINUTES = 10;
/** Máximo de envíos externos por hora que puede provocar una misma persona (o el sistema a una misma persona). */
const MAX_EXTERNAL_PER_HOUR = 40;

/**
 * Los avisos en la app se crean siempre; el email, Telegram y WhatsApp (que puede costar dinero)
 * se limitan: uno por persona y tarea cada 10 minutos y un tope por hora: por autor o, en los avisos del sistema,
 * por destinatario; lo hecho desde «Compartir fuera», por enlace (el cubo de la acción, ActionContext.notifyBucket).
 */
async function externalAllowed(actorId: string | null, type: NotificationKind, taskId: string, recipientIds: string[], newIds: string[]): Promise<Set<string>> {
  const since = new Date(Date.now() - DEDUPE_MINUTES * 60_000);
  const recent = await db.notification.findMany({
    where: {
      taskId,
      type,
      userId: { in: recipientIds },
      createdAt: { gte: since },
      // Cualquier aviso previo reciente del mismo tipo (enviado o en curso) basta: así dos comentarios seguidos no
      // duplican, pero un comentario no silencia el email de una asignación.
      id: { notIn: newIds },
    },
    select: { userId: true },
  });
  const skip = new Set(recent.map((r) => r.userId));
  // Quien no quiere ningún envío externo de este tipo no gasta el límite por hora.
  const [prefs, messaging] = await Promise.all([
    db.user.findMany({
      where: { id: { in: recipientIds } },
      select: { id: true, notifyEmail: true, notifyAssignedEmail: true, notifyDueEmail: true, notifyCommentEmail: true, channels: { select: CHANNEL_SELECT } },
    }),
    loadMessagingConfig(),
  ]);
  const wanted = new Set(prefs.filter((u) => externalWanted(type, u, messaging)).map((u) => u.id));
  const bucket = actionContext.getStore()?.notifyBucket ?? null;
  const allowed = new Set<string>();
  for (const id of recipientIds) {
    if (skip.has(id) || !wanted.has(id)) continue;
    // Los de una persona, con tope por autor (nadie inunda a los demás). Los del sistema (recordatorios de «Esperando»),
    // por destinatario: con uno solo para todos, a partir del 40.º de la hora nadie más recibía el email.
    // Con un cubo propio (lo hecho desde «Compartir fuera»: uno por enlace), el suyo, con su tope, para todos los destinatarios.
    if (bucket) {
      if (!rateLimit(`notify:${bucket.key}`, bucket.limit, 60 * 60_000)) {
        console.error("[notify] Límite de envíos externos alcanzado para", bucket.key);
        break;
      }
    } else if (!rateLimit(actorId ? `notify:${actorId}` : `notify:system:${id}`, MAX_EXTERNAL_PER_HOUR, 60 * 60_000)) {
      console.error("[notify] Límite de envíos externos alcanzado para", actorId ?? `el sistema (destinatario ${id})`);
      if (actorId) break;
      continue;
    }
    allowed.add(id);
  }
  return allowed;
}

/**
 * Aviso a cada administrador activo de que un proyecto privado ha pasado a ser de equipo al borrarse la cuenta de su
 * único miembro activo (eraseUser): uno por proyecto y administrador, con enlace al proyecto. En la campana siempre; por
 * email, Telegram y WhatsApp según sus preferencias de «Avisos de menciones» (emailWanted, channelWants). El texto se
 * escribe al leerlo, en el idioma de cada uno. `deletedName` queda en el extracto (la cuenta ya no existe). `excludeId`:
 * el administrador que ha borrado la cuenta, que acaba de ver la lista al confirmar.
 */
export async function notifyProjectsToTeam(projects: readonly { id: string }[], deletedName: string, excludeId: string | null = null): Promise<string[]> {
  if (!projects.length) return [];
  const admins = await db.user.findMany({ where: { role: "ADMIN", active: true, ...(excludeId ? { id: { not: excludeId } } : {}) }, select: { id: true } });
  // Solo los que siguen siendo de equipo (un administrador podría haberlo cambiado ya).
  const still = await db.project.findMany({ where: { id: { in: projects.map((p) => p.id) }, isPrivate: false }, select: { id: true } });
  if (!admins.length || !still.length) return [];
  const created = await db.notification.createManyAndReturn({
    data: still.flatMap((p) => admins.map((a) => ({ userId: a.id, actorId: null, projectId: p.id, type: "PROJECT_TO_TEAM" as const, excerpt: deletedName.slice(0, 200) }))),
    select: { id: true, userId: true, projectId: true },
  });
  const [prefs, messaging] = await Promise.all([
    db.user.findMany({ where: { id: { in: admins.map((a) => a.id) } }, select: { id: true, notifyEmail: true, notifyAssignedEmail: true, notifyDueEmail: true, notifyCommentEmail: true, channels: { select: CHANNEL_SELECT } } }),
    loadMessagingConfig(),
  ]);
  const wanted = new Set(prefs.filter((u) => externalWanted("PROJECT_TO_TEAM", u, messaging)).map((u) => u.id));
  // Mismo tope por hora que los avisos del sistema, por destinatario.
  const toDeliver = created.filter((c) => wanted.has(c.userId) && rateLimit(`notify:system:${c.userId}`, MAX_EXTERNAL_PER_HOUR, 60 * 60_000)).map((c) => c.id);
  for (const p of still) {
    logEvent({
      category: "notify", action: "notify.project_to_team", label: { k: "{n} aviso(s) a administradores: un proyecto privado ha pasado a ser de equipo", p: { n: admins.length } },
      projectId: p.id, details: { recipients: admins.map((a) => a.id), externalRecipients: created.filter((c) => c.projectId === p.id && toDeliver.includes(c.id)).map((c) => c.userId) },
    });
  }
  if (toDeliver.length) {
    const send = () => deliver(toDeliver).catch((err) => console.error("[notify] envío", err));
    // Fuera de una petición no hay `after`: se envía aquí mismo.
    try {
      after(() => trackInFlight(send));
    } catch {
      await send();
    }
  }
  return created.map((c) => c.id);
}

/**
 * Aviso a quien configuró el informe semanal (la última persona que lo guardó, `createdById`) de que su destinatario se
 * ha dado de baja con el enlace del email: el informe ya no sale y solo esa persona puede volver a activarlo para sí
 * misma. `who`: el nombre de la persona que se dio de baja o, si no tiene cuenta, su dirección enmascarada (queda en el
 * extracto). Ver notifyProjectPerson.
 */
export async function notifyReportUnsubscribed(projectId: string, setterId: string, who: string): Promise<string | null> {
  return notifyProjectPerson("REPORT_UNSUBSCRIBED", projectId, setterId, who.slice(0, 200), {
    action: "notify.report_unsubscribed",
    label: "Aviso a quien configuró el informe semanal: su destinatario se ha dado de baja",
    labelExternal: "Aviso a quien configuró el informe semanal: su destinatario se ha dado de baja (con envío externo)",
  });
}

/**
 * Aviso a quien generó la web de «Compartir fuera» (`generatedById`) de que otra persona del proyecto ha revocado su
 * enlace a mano (revokeShareLink). Las revocaciones automáticas (apagar la función, quitar el rol, borrar la columna,
 * caducar) no avisan. Ver notifyProjectPerson; `who` y `column` van en el extracto (shareRevokedExcerpt).
 */
export async function notifyShareRevoked(projectId: string, generatorId: string, who: string, column: string): Promise<string | null> {
  return notifyProjectPerson("SHARE_REVOKED", projectId, generatorId, shareRevokedExcerpt(who, column), {
    action: "notify.share_revoked",
    label: "Aviso a quien generó la web: otra persona ha revocado su enlace",
    labelExternal: "Aviso a quien generó la web: otra persona ha revocado su enlace (con envío externo)",
  });
}

/**
 * Aviso de proyecto a una sola persona (REPORT_UNSUBSCRIBED, SHARE_REVOKED). En la campana siempre; por email, Telegram
 * y WhatsApp según sus preferencias de las menciones, como los demás avisos de administración (emailWanted,
 * channelWants), con el tope por hora de los avisos del sistema. Solo si sigue activa y viendo el proyecto.
 */
async function notifyProjectPerson(type: "REPORT_UNSUBSCRIBED" | "SHARE_REVOKED", projectId: string, userId: string, excerpt: string, log: { action: string; label: string; labelExternal: string }): Promise<string | null> {
  const project = await db.project.findUnique({ where: { id: projectId }, select: { isPrivate: true } });
  if (!project) return null;
  const person = await db.user.findFirst({
    where: mentionRecipientsWhere(project, [userId], projectId),
    select: { id: true, notifyEmail: true, notifyAssignedEmail: true, notifyDueEmail: true, notifyCommentEmail: true, channels: { select: CHANNEL_SELECT } },
  });
  if (!person) return null;
  const created = await db.notification.create({
    data: { userId: person.id, actorId: null, projectId, type, excerpt },
    select: { id: true },
  });
  const messaging = await loadMessagingConfig();
  const wanted = externalWanted(type, person, messaging);
  // Mismo tope por hora que los avisos del sistema, por destinatario.
  const external = wanted && rateLimit(`notify:system:${person.id}`, MAX_EXTERNAL_PER_HOUR, 60 * 60_000);
  logEvent({
    category: "notify", action: log.action, label: { k: external ? log.labelExternal : log.label },
    projectId, details: { recipients: [person.id], externalRecipients: external ? [person.id] : [] },
  });
  if (external) {
    const send = () => deliver([created.id]).catch((err) => console.error("[notify] envío", err));
    // Fuera de una petición no hay `after`: se envía aquí mismo.
    try {
      after(() => trackInFlight(send));
    } catch {
      await send();
    }
  }
  return created.id;
}
