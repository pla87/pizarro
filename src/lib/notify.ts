import "server-only";
import { after } from "next/server";
import type { Prisma } from "@/generated/prisma/client";
import { intlLocale, makeT, toLocale, type T } from "../i18n/core";
import { db } from "./db";
import { appUrl, emailEnabled, escapeHtml, sendMail } from "./mail";
import { logEvent } from "./log";
import { excerpt as makeExcerpt, mentionsToPlain } from "./mentions";
import { dueChangeText, notificationHeadline, type NotificationKind } from "./notification-text";
import { followerIds } from "./followers";
import { rateLimit } from "./rate-limit";

// Avisos (menciones, asignaciones, cambios de fecha, comentarios y respuestas): en la app (tabla
// Notification), por email (SMTP) y, solo las menciones, por WhatsApp (Cloud API de Meta). Los envíos
// externos se hacen tras responder al usuario (after), para que avisar no añada espera.

export { emailEnabled };

export function whatsappEnabled(): boolean {
  return Boolean(process.env.WHATSAPP_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID && process.env.WHATSAPP_TEMPLATE_NAME);
}

interface MentionMessage {
  /** Tipo de aviso; sin indicar, una mención. */
  type?: NotificationKind;
  actorName: string;
  taskTitle: string;
  projectName: string;
  excerpt: string;
  url: string;
  /** Idioma de Intl para formatear fechas (cambio de fecha límite). */
  locale?: string;
}

/** Email de un aviso: asunto, texto plano y HTML (todo el contenido del usuario va escapado). */
export function mentionEmail(m: MentionMessage, t: T = makeT("es")) {
  const type = m.type ?? "MENTION";
  const body = type === "DUE_CHANGED" ? dueChangeText(m.excerpt, t, m.locale ?? "es-ES") : m.excerpt;
  const subject = notificationHeadline(type, t, { actor: m.actorName, task: `«${m.taskTitle}»` });
  const text = `${notificationHeadline(type, t, { actor: m.actorName, task: `«${m.taskTitle}»` })} (${m.projectName})${body ? `:\n\n${body}` : ""}\n\n${t("Abrir la tarea")}: ${m.url}\n`;
  const headline = notificationHeadline(type, t, { actor: `<strong>${escapeHtml(m.actorName)}</strong>`, task: `<strong>«${escapeHtml(m.taskTitle)}»</strong>` });
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

/** Cuerpo de la petición a la Cloud API: plantilla con 4 parámetros (ver README). */
export function whatsappPayload(to: string, m: MentionMessage) {
  const param = (text: string) => ({ type: "text", text: text.replace(/\s+/g, " ").slice(0, 300) });
  return {
    messaging_product: "whatsapp",
    to: to.replace(/^\+/, ""),
    type: "template",
    template: {
      name: process.env.WHATSAPP_TEMPLATE_NAME,
      language: { code: process.env.WHATSAPP_TEMPLATE_LANG ?? "es" },
      components: [
        { type: "body", parameters: [param(m.actorName), param(m.taskTitle), param(m.projectName), param(m.url)] },
      ],
    },
  };
}

async function sendWhatsapp(to: string, m: MentionMessage): Promise<void> {
  const version = process.env.WHATSAPP_API_VERSION ?? "v23.0";
  const res = await fetch(`https://graph.facebook.com/${version}/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(whatsappPayload(to, m)),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    const json = await res.json().catch(() => ({}));
    throw new Error(`WhatsApp ${res.status}: ${json?.error?.message ?? "error"}`);
  }
}

async function deliver(notificationIds: string[]): Promise<void> {
  if (!notificationIds.length || (!emailEnabled() && !whatsappEnabled())) return;
  const rows = await db.notification.findMany({
    where: { id: { in: notificationIds } },
    select: {
      id: true,
      type: true,
      excerpt: true,
      user: { select: { id: true, name: true, email: true, locale: true, active: true, notifyEmail: true, notifyAssignedEmail: true, notifyDueEmail: true, notifyCommentEmail: true, notifyWhatsapp: true, whatsappPhone: true } },
      actor: { select: { name: true } },
      task: { select: { id: true, title: true, project: { select: { id: true, name: true } } } },
    },
  });
  for (const n of rows) {
    if (!n.task || !n.user.active) continue;
    const t = makeT(toLocale(n.user.locale));
    const msg: MentionMessage = {
      type: n.type,
      locale: intlLocale(toLocale(n.user.locale)),
      actorName: n.actor?.name ?? t("Alguien"),
      taskTitle: mentionsToPlain(n.task.title),
      projectName: n.task.project.name,
      excerpt: n.excerpt,
      url: `${appUrl()}/p/${n.task.project.id}?task=${n.task.id}`,
    };
    const update: { emailSentAt?: Date; whatsappSentAt?: Date; deliveryError?: string } = {};
    const errors: string[] = [];
    const base = { category: "notify", userId: n.user.id, userName: n.user.name, projectId: n.task.project.id };
    if (emailEnabled() && emailWanted(n.type, n.user)) {
      const t0 = performance.now();
      try {
        await sendMail({ to: n.user.email, ...mentionEmail(msg, t) });
        update.emailSentAt = new Date();
        logEvent({ ...base, action: "notify.email", message: `Email de aviso (${n.type}) enviado a ${n.user.name}`, durationMs: performance.now() - t0, details: { notificationId: n.id, taskId: n.task.id, to: n.user.email } });
      } catch (err) {
        errors.push(`email: ${(err as Error).message}`);
        logEvent({ ...base, level: "error", action: "notify.emailFailed", message: `Fallo al enviar email a ${n.user.name}: ${(err as Error).message}`, durationMs: performance.now() - t0, details: { notificationId: n.id, taskId: n.task.id, to: n.user.email } });
      }
    }
    // WhatsApp solo para menciones: la plantilla aprobada por Meta es la de mención.
    if (n.type === "MENTION" && whatsappEnabled() && n.user.notifyWhatsapp && n.user.whatsappPhone) {
      const t0 = performance.now();
      try {
        await sendWhatsapp(n.user.whatsappPhone, msg);
        update.whatsappSentAt = new Date();
        logEvent({ ...base, action: "notify.whatsapp", message: `WhatsApp de mención enviado a ${n.user.name}`, durationMs: performance.now() - t0, details: { notificationId: n.id, taskId: n.task.id } });
      } catch (err) {
        errors.push((err as Error).message);
        logEvent({ ...base, level: "error", action: "notify.whatsappFailed", message: `Fallo al enviar WhatsApp a ${n.user.name}: ${(err as Error).message}`, durationMs: performance.now() - t0, details: { notificationId: n.id, taskId: n.task.id } });
      }
    }
    if (errors.length) {
      update.deliveryError = errors.join(" | ").slice(0, 500);
      console.error("[notify]", n.id, update.deliveryError);
    }
    if (Object.keys(update).length) await db.notification.update({ where: { id: n.id }, data: update });
  }
}

/**
 * Quién puede recibir un aviso entre los mencionados: activos y con acceso al proyecto. Con un proyecto
 * privado, solo sus miembros (y solo los mencionados).
 */
export function mentionRecipientsWhere(project: { restricted: boolean; isPrivate: boolean }, ids: string[], projectId: string): Prisma.UserWhereInput {
  return {
    id: { in: ids },
    active: true,
    ...(project.isPrivate ? { memberships: { some: { projectId } } } : project.restricted ? { OR: [{ role: "ADMIN" }, { memberships: { some: { projectId } } }] } : {}),
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
}): Promise<string[]> {
  const n = await notifyTask({ type: "MENTION", actorId: opts.actorId, taskId: opts.taskId, projectId: opts.projectId, recipientIds: opts.recipientIds, excerpt: makeExcerpt(opts.text) });
  if (n.recipients.length) await followTask(opts.taskId, n.recipients);
  return n.recipients;
}

/**
 * Crea avisos (en la app, siempre) del tipo indicado para quienes estén activos, no sean el autor y
 * puedan ver el proyecto (en uno privado, solo sus miembros). Devuelve los destinatarios.
 */
export async function notifyTask(opts: {
  type: NotificationKind;
  actorId: string;
  taskId: string;
  projectId: string;
  recipientIds: string[];
  excerpt: string;
}): Promise<{ recipients: string[] }> {
  const ids = [...new Set(opts.recipientIds.filter((id) => id !== opts.actorId))];
  if (!ids.length) return { recipients: [] };
  const project = await db.project.findUnique({ where: { id: opts.projectId }, select: { restricted: true, isPrivate: true } });
  if (!project) return { recipients: [] };
  const recipients = await db.user.findMany({
    where: mentionRecipientsWhere(project, ids, opts.projectId),
    select: { id: true },
  });
  if (!recipients.length) return { recipients: [] };
  const created = await db.notification.createManyAndReturn({
    data: recipients.map((r) => ({ userId: r.id, actorId: opts.actorId, taskId: opts.taskId, type: opts.type, excerpt: opts.excerpt })),
    select: { id: true, userId: true },
  });
  const createdIds = created.map((c) => c.id);
  // Por email solo si la persona lo quiere para este tipo; WhatsApp, solo menciones (lo decide deliver).
  const external = await externalAllowed(opts.actorId, opts.taskId, created.map((c) => c.userId), createdIds);
  logEvent({
    category: "notify", action: `notify.${opts.type.toLowerCase()}`, message: `${createdIds.length} aviso(s) ${opts.type} creados (${external.size} con envío externo)`,
    userId: opts.actorId, projectId: opts.projectId,
    details: { taskId: opts.taskId, recipients: created.map((c) => c.userId), externalRecipients: [...external] },
  });
  const toDeliver = created.filter((c) => external.has(c.userId)).map((c) => c.id);
  if (toDeliver.length) after(() => deliver(toDeliver).catch((err) => console.error("[notify] envío", err)));
  return { recipients: created.map((c) => c.userId) };
}

/** Ventana en la que no se repite email/WhatsApp a la misma persona por la misma tarea. */
const DEDUPE_MINUTES = 10;
/** Máximo de envíos externos que puede provocar una misma persona por hora. */
const MAX_EXTERNAL_PER_HOUR = 40;

/**
 * Los avisos en la app se crean siempre; el email y el WhatsApp (que pueden costar dinero)
 * se limitan: uno por persona y tarea cada 10 minutos y un tope por autor y hora.
 */
async function externalAllowed(actorId: string, taskId: string, recipientIds: string[], newIds: string[]): Promise<Set<string>> {
  const since = new Date(Date.now() - DEDUPE_MINUTES * 60_000);
  const recent = await db.notification.findMany({
    where: {
      taskId,
      userId: { in: recipientIds },
      createdAt: { gte: since },
      // Cualquier aviso previo reciente (enviado o en curso) basta: así dos comentarios seguidos no duplican.
      id: { notIn: newIds },
    },
    select: { userId: true },
  });
  const skip = new Set(recent.map((r) => r.userId));
  const allowed = new Set<string>();
  for (const id of recipientIds) {
    if (skip.has(id)) continue;
    if (!rateLimit(`notify:${actorId}`, MAX_EXTERNAL_PER_HOUR, 60 * 60_000)) {
      console.error("[notify] Límite de envíos externos alcanzado para", actorId);
      break;
    }
    allowed.add(id);
  }
  return allowed;
}
