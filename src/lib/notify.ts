import "server-only";
import { after } from "next/server";
import type { Prisma } from "@/generated/prisma/client";
import { intlLocale, makeT, toLocale, type T } from "../i18n/core";
import { projectUsersWhere } from "./access";
import { db } from "./db";
import { appUrl, emailEnabled, escapeHtml, sendMail } from "./mail";
import { logEvent } from "./log";
import { maskEmail, maskEmailsIn } from "./mask-email";
import { excerpt as makeExcerpt, mentionsToPlain } from "./mentions";
import { notificationBody, notificationHeadline, type NotificationKind } from "./notification-text";
import { loadMessagingConfig, type MessagingConfig } from "./messaging-config";
import {
  CHANNEL_LIMIT_PER_HOUR, channelUsable, channelWants, classifyFailure, maskPhone, scrubSecrets, telegramNoticeText, type ChannelPrefs, type NoticeMessage,
} from "./messaging-core";
import { disconnectTelegramChat, sendTelegramMessage } from "./telegram";
import { sendWhatsappNotice, whatsappLocale } from "./whatsapp";
import { followerIds } from "./followers";
import { rateLimit } from "./rate-limit";

// Avisos (menciones, asignaciones, cambios de fecha, comentarios y respuestas): en la app (tabla Notification), por
// email (SMTP) y por los canales que cada persona conecta en Mi perfil → Avisos (Telegram y WhatsApp, si el
// administrador los ha activado en Administración → Ajustes). Los envíos externos se hacen tras responder al usuario
// (after), para que avisar no añada espera.

export { emailEnabled };

/** Datos de un aviso para el email y los mensajes (mismo contenido en todos los canales). */
export type MentionMessage = NoticeMessage;

/** Email de un aviso: asunto, texto plano y HTML (todo el contenido del usuario va escapado). */
export function mentionEmail(m: MentionMessage, t: T = makeT("es")) {
  const type = m.type ?? "MENTION";
  const body = notificationBody(type, m.excerpt, t, m.locale ?? "es-ES");
  // Las comillas del título van en la plantilla traducida: «…» en español, “…” en inglés.
  const task = t("«{title}»", { title: m.taskTitle });
  const subject = notificationHeadline(type, t, { actor: m.actorName, task });
  const text = `${subject} (${m.projectName})${body ? `:\n\n${body}` : ""}\n\n${t("Abrir la tarea")}: ${m.url}\n`;
  const headline = notificationHeadline(type, t, { actor: `<strong>${escapeHtml(m.actorName)}</strong>`, task: `<strong>${escapeHtml(task)}</strong>` });
  const html = `<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;font-size:15px;color:#0f172a;max-width:560px">
<p>${headline} · ${escapeHtml(m.projectName)}</p>
${body ? `<blockquote style="margin:12px 0;padding:8px 12px;border-left:4px solid #6366f1;background:#f8fafc;color:#334155">${escapeHtml(body)}</blockquote>` : ""}
<p><a href="${escapeHtml(m.url)}" style="display:inline-block;background:#4f46e5;color:#fff;padding:9px 16px;border-radius:8px;text-decoration:none">${escapeHtml(t("Abrir la tarea"))}</a></p>
<p style="color:#94a3b8;font-size:12px">${escapeHtml(t("Puedes desactivar estos avisos en «Mi perfil» de Pizarro."))}</p></div>`;
  return { subject, text, html };
}

/** ¿Quiere esta persona el email de este tipo de aviso? (en la app se crean siempre) */
export function emailWanted(type: NotificationKind, u: { notifyEmail: boolean; notifyAssignedEmail: boolean; notifyDueEmail: boolean; notifyCommentEmail: boolean }): boolean {
  switch (type) {
    case "ASSIGNED": return u.notifyAssignedEmail;
    case "DUE_CHANGED": return u.notifyDueEmail;
    case "COMMENT":
    case "REPLY": return u.notifyCommentEmail;
    default: return u.notifyEmail;
  }
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
      user: { select: { id: true, name: true, email: true, locale: true, active: true, notifyEmail: true, notifyAssignedEmail: true, notifyDueEmail: true, notifyCommentEmail: true, channels: { select: CHANNEL_SELECT } } },
      actor: { select: { name: true } },
      task: { select: { id: true, title: true, project: { select: { id: true, name: true, isPrivate: true } } } },
    },
  });
  // El envío sale después de crear el aviso: se vuelve a comprobar que cada persona sigue pudiendo ver el
  // proyecto (p. ej. la han sacado de un proyecto privado entre medias). Si no, no sale nada por fuera.
  const allowed = new Set<string>();
  const byProject = new Map<string, { isPrivate: boolean; userIds: string[] }>();
  for (const n of rows) {
    if (!n.task) continue;
    const entry = byProject.get(n.task.project.id) ?? { isPrivate: n.task.project.isPrivate, userIds: [] };
    entry.userIds.push(n.user.id);
    byProject.set(n.task.project.id, entry);
  }
  for (const [projectId, { isPrivate, userIds }] of byProject) {
    const ok = await db.user.findMany({ where: mentionRecipientsWhere({ isPrivate }, userIds, projectId), select: { id: true } });
    for (const u of ok) allowed.add(`${projectId}:${u.id}`);
  }
  for (const n of rows) {
    if (!n.task || !n.user.active) continue;
    if (!allowed.has(`${n.task.project.id}:${n.user.id}`)) {
      logEvent({ category: "notify", action: "notify.skippedNoAccess", message: `Envío externo omitido: ${n.user.name} ya no tiene acceso al proyecto`, userId: n.user.id, userName: n.user.name, projectId: n.task.project.id, details: { notificationId: n.id, taskId: n.task.id } });
      continue;
    }
    const locale = toLocale(n.user.locale);
    const t = makeT(locale);
    const msg: MentionMessage = {
      type: n.type,
      locale: intlLocale(locale),
      actorName: n.actor?.name ?? t("Alguien"),
      taskTitle: mentionsToPlain(n.task.title),
      projectName: n.task.project.name,
      excerpt: n.excerpt,
      url: `${appUrl()}/p/${n.task.project.id}?task=${n.task.id}`,
    };
    const update: { emailSentAt?: Date; whatsappSentAt?: Date; telegramSentAt?: Date; deliveryError?: string } = {};
    const errors: string[] = [];
    const base = { category: "notify", userId: n.user.id, userName: n.user.name, projectId: n.task.project.id };
    if (emailEnabled() && emailWanted(n.type, n.user)) {
      const t0 = performance.now();
      try {
        await sendMail({ to: n.user.email, ...mentionEmail(msg, t) });
        update.emailSentAt = new Date();
        logEvent({ ...base, action: "notify.email", message: `Email de aviso (${n.type}) enviado a ${n.user.name}`, durationMs: performance.now() - t0, details: { notificationId: n.id, taskId: n.task.id, to: maskEmail(n.user.email) } });
      } catch (err) {
        errors.push(`email: ${(err as Error).message}`);
        logEvent({ ...base, level: "error", action: "notify.emailFailed", message: `Fallo al enviar email a ${n.user.name}: ${maskEmailsIn((err as Error).message)}`, durationMs: performance.now() - t0, details: { notificationId: n.id, taskId: n.task.id, to: maskEmail(n.user.email) } });
      }
    }
    for (const ch of channelsFor(n.type, n.user.channels, messaging)) {
      const name = ch.channel === "TELEGRAM" ? "Telegram" : "WhatsApp";
      const key = ch.channel === "TELEGRAM" ? "telegram" : "whatsapp";
      const details = { notificationId: n.id, taskId: n.task.id, type: n.type, ...(ch.channel === "WHATSAPP" ? { to: maskPhone(ch.address) } : {}) };
      // Tope por persona y canal: una avalancha de avisos no se convierte en una avalancha de mensajes (ni de gasto).
      if (!rateLimit(`notify:${key}:${n.user.id}`, CHANNEL_LIMIT_PER_HOUR[ch.channel], 60 * 60_000)) {
        if (rateLimit(`notify:${key}:${n.user.id}:warned`, 1, 60 * 60_000)) logEvent({ ...base, level: "warn", action: `notify.${key}RateLimited`, message: `Tope de ${CHANNEL_LIMIT_PER_HOUR[ch.channel]} mensajes por hora de ${name} alcanzado para ${n.user.name}: los siguientes avisos de esta hora solo quedan en la app`, details });
        continue;
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
          const waMsg = waLocale === locale ? msg : { ...msg, locale: intlLocale(waLocale), actorName: n.actor?.name ?? tw("Alguien") };
          await sendWhatsappNotice(messaging.whatsapp, ch.address, waMsg, tw, waLocale === "en");
          update.whatsappSentAt = new Date();
        }
        logEvent({ ...base, action: `notify.${key}`, message: `${name}: aviso (${n.type}) enviado a ${n.user.name}`, durationMs: performance.now() - t0, details });
      } catch (err) {
        const reason = scrubSecrets((err as Error).message, [messaging.telegram.token, messaging.whatsapp.token, ch.address]);
        errors.push(`${key}: ${reason}`);
        logEvent({ ...base, level: "error", action: `notify.${key}Failed`, message: `Fallo al enviar ${name} a ${n.user.name}: ${reason}`, durationMs: performance.now() - t0, details });
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
    category: "notify", action: `notify.${opts.type.toLowerCase()}`, message: `${createdIds.length} aviso(s) ${opts.type} creados (${external.size} con envío externo)`,
    userId: opts.actorId ?? undefined, projectId: opts.projectId,
    details: { taskId: opts.taskId, recipients: created.map((c) => c.userId), externalRecipients: [...external] },
  });
  const toDeliver = created.filter((c) => external.has(c.userId)).map((c) => c.id);
  if (toDeliver.length) {
    const send = () => deliver(toDeliver).catch((err) => console.error("[notify] envío", err));
    if (opts.immediate) await send();
    else after(send);
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
 * por destinatario.
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
  const wanted = new Set(prefs.filter((u) => emailWanted(type, u) || channelsFor(type, u.channels, messaging).length > 0).map((u) => u.id));
  const allowed = new Set<string>();
  for (const id of recipientIds) {
    if (skip.has(id) || !wanted.has(id)) continue;
    // Los de una persona, con tope por autor (nadie inunda a los demás). Los del sistema (recordatorios de «Esperando»),
    // por destinatario: con uno solo para todos, a partir del 40.º de la hora nadie más recibía el email.
    if (!rateLimit(actorId ? `notify:${actorId}` : `notify:system:${id}`, MAX_EXTERNAL_PER_HOUR, 60 * 60_000)) {
      console.error("[notify] Límite de envíos externos alcanzado para", actorId ?? `el sistema (destinatario ${id})`);
      if (actorId) break;
      continue;
    }
    allowed.add(id);
  }
  return allowed;
}
