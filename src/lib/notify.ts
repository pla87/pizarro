import "server-only";
import { after } from "next/server";
import type { Prisma } from "@/generated/prisma/client";
import nodemailer from "nodemailer";
import { makeT, toLocale, type T } from "../i18n/core";
import { db } from "./db";
import { logEvent } from "./log";
import { excerpt as makeExcerpt } from "./mentions";
import { rateLimit } from "./rate-limit";

// Avisos de menciones: en la app (tabla Notification), por email (SMTP) y por
// WhatsApp (Cloud API de Meta). Los envíos externos se hacen tras responder al
// usuario (after), para que mencionar a alguien no añada espera.

export function emailEnabled(): boolean {
  return Boolean(process.env.SMTP_HOST && process.env.SMTP_FROM);
}

export function whatsappEnabled(): boolean {
  return Boolean(process.env.WHATSAPP_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID && process.env.WHATSAPP_TEMPLATE_NAME);
}

let transport: ReturnType<typeof nodemailer.createTransport> | null = null;
function mailer() {
  const port = Number(process.env.SMTP_PORT ?? 465);
  transport ??= nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure: port === 465,
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
    connectionTimeout: 10_000,
    socketTimeout: 15_000,
  });
  return transport;
}

function appUrl(): string {
  return (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
}

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

interface MentionMessage {
  actorName: string;
  taskTitle: string;
  projectName: string;
  excerpt: string;
  url: string;
}

export function mentionEmail(m: MentionMessage, t: T = makeT("es")) {
  const subject = t("{actor} te ha mencionado en «{task}»", { actor: m.actorName, task: m.taskTitle });
  const text = `${t("{actor} te ha mencionado en la tarea «{task}» ({project}):", { actor: m.actorName, task: m.taskTitle, project: m.projectName })}\n\n${m.excerpt}\n\n${t("Abrir la tarea")}: ${m.url}\n`;
  const html = `<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;font-size:15px;color:#0f172a;max-width:560px">
<p>${t("{actor} te ha mencionado en la tarea {task}", { actor: `<strong>${escapeHtml(m.actorName)}</strong>`, task: `<strong>«${escapeHtml(m.taskTitle)}»</strong>` })} · ${escapeHtml(m.projectName)}</p>
<blockquote style="margin:12px 0;padding:8px 12px;border-left:4px solid #6366f1;background:#f8fafc;color:#334155">${escapeHtml(m.excerpt)}</blockquote>
<p><a href="${escapeHtml(m.url)}" style="display:inline-block;background:#4f46e5;color:#fff;padding:9px 16px;border-radius:8px;text-decoration:none">${escapeHtml(t("Abrir la tarea"))}</a></p>
<p style="color:#94a3b8;font-size:12px">${escapeHtml(t("Puedes desactivar estos avisos en «Mi perfil» de Pizarro."))}</p></div>`;
  return { subject, text, html };
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
      excerpt: true,
      user: { select: { id: true, name: true, email: true, locale: true, active: true, notifyEmail: true, notifyWhatsapp: true, whatsappPhone: true } },
      actor: { select: { name: true } },
      task: { select: { id: true, title: true, project: { select: { id: true, name: true } } } },
    },
  });
  for (const n of rows) {
    if (!n.task || !n.user.active) continue;
    const t = makeT(toLocale(n.user.locale));
    const msg: MentionMessage = {
      actorName: n.actor?.name ?? t("Alguien"),
      taskTitle: n.task.title,
      projectName: n.task.project.name,
      excerpt: n.excerpt,
      url: `${appUrl()}/p/${n.task.project.id}?task=${n.task.id}`,
    };
    const update: { emailSentAt?: Date; whatsappSentAt?: Date; deliveryError?: string } = {};
    const errors: string[] = [];
    const base = { category: "notify", userId: n.user.id, userName: n.user.name, projectId: n.task.project.id };
    if (emailEnabled() && n.user.notifyEmail) {
      const t0 = performance.now();
      try {
        await mailer().sendMail({ from: process.env.SMTP_FROM, to: n.user.email, ...mentionEmail(msg, t) });
        update.emailSentAt = new Date();
        logEvent({ ...base, action: "notify.email", message: `Email de mención enviado a ${n.user.name}`, durationMs: performance.now() - t0, details: { notificationId: n.id, taskId: n.task.id, to: n.user.email } });
      } catch (err) {
        errors.push(`email: ${(err as Error).message}`);
        logEvent({ ...base, level: "error", action: "notify.emailFailed", message: `Fallo al enviar email a ${n.user.name}: ${(err as Error).message}`, durationMs: performance.now() - t0, details: { notificationId: n.id, taskId: n.task.id, to: n.user.email } });
      }
    }
    if (whatsappEnabled() && n.user.notifyWhatsapp && n.user.whatsappPhone) {
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
 * privado, solo su dueño (y solo si lo han mencionado: antes la condición del dueño pisaba la lista y
 * avisaba al dueño aunque mencionaran a otra persona).
 */
export function mentionRecipientsWhere(project: { restricted: boolean; privateOwnerId: string | null }, ids: string[], projectId: string): Prisma.UserWhereInput {
  const mentioned = project.privateOwnerId ? ids.filter((id) => id === project.privateOwnerId) : ids;
  return {
    id: { in: mentioned },
    active: true,
    ...(project.restricted ? { OR: [{ role: "ADMIN" }, { memberships: { some: { projectId } } }] } : {}),
  };
}

/**
 * Crea avisos de mención para los usuarios indicados que estén activos, no sean el autor
 * y puedan ver el proyecto. Devuelve cuántos se han creado.
 */
export async function notifyMentions(opts: {
  actorId: string;
  taskId: string;
  projectId: string;
  recipientIds: string[];
  text: string;
}): Promise<number> {
  const ids = opts.recipientIds.filter((id) => id !== opts.actorId);
  if (!ids.length) return 0;
  const project = await db.project.findUnique({ where: { id: opts.projectId }, select: { restricted: true, privateOwnerId: true } });
  if (!project) return 0;
  const recipients = await db.user.findMany({
    where: mentionRecipientsWhere(project, ids, opts.projectId),
    select: { id: true },
  });
  if (!recipients.length) return 0;
  const excerpt = makeExcerpt(opts.text);
  const created = await db.notification.createManyAndReturn({
    data: recipients.map((r) => ({ userId: r.id, actorId: opts.actorId, taskId: opts.taskId, excerpt })),
    select: { id: true },
  });
  const createdIds = created.map((c) => c.id);
  const external = await externalAllowed(opts.actorId, opts.taskId, recipients.map((r) => r.id), createdIds);
  logEvent({
    category: "notify", action: "notify.mentions", message: `${createdIds.length} aviso(s) de mención creados (${external.size} con envío externo)`,
    userId: opts.actorId, projectId: opts.projectId,
    details: { taskId: opts.taskId, recipients: recipients.map((r) => r.id), externalRecipients: [...external] },
  });
  const toDeliver = created.filter((_, i) => external.has(recipients[i]!.id)).map((c) => c.id);
  if (toDeliver.length) after(() => deliver(toDeliver).catch((err) => console.error("[notify] envío", err)));
  return createdIds.length;
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
