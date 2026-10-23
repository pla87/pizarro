import "server-only";
import { reportRecipientAllowed } from "./report-recipient";
import { intlLocale, makeT, toLocale, type T } from "../i18n/core";
import { visibleProjectsWhere, workingProjectsWhere } from "./access";
import { appTimeZone } from "./board";
import { isoToDate, todayIso } from "./dates";
import { db } from "./db";
import { buildDigest, digestEmail, emptyDigestInput, type DigestInput, type DigestItem } from "./digest";
import { logEvent } from "./log";
import { appUrl, emailEnabled, escapeHtml, sendMail } from "./mail";
import { generateProjectReportPdf } from "./report-build";
import { digestDue, reportDue } from "./schedule";
import type { CurrentUser } from "./session";

// Envíos periódicos por email (resumen diario e informe semanal). Los lanza el mantenimiento cada hora;
// ver schedule.ts para cuándo toca cada uno. Se «reserva» el envío antes de hacerlo (compare-and-set de la
// fecha del último) para que dos procesos no manden el mismo correo, y se devuelve la reserva si falla.

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_ROWS = 300;

const taskSelect = { id: true, title: true, project: { select: { id: true, name: true } } } as const;
type TaskRow = { id: string; title: string; project: { id: string; name: string } };
const item = (t: TaskRow, extra: Partial<DigestItem> = {}): DigestItem => ({ taskId: t.id, title: t.title, projectId: t.project.id, projectName: t.project.name, ...extra });

/** Lo ocurrido en las últimas 24 h en los proyectos visibles para la persona, y lo que le toca a ella. */
export async function gatherDigest(user: { id: string; role: "ADMIN" | "MEMBER" }, now: Date, today: string): Promise<DigestInput> {
  const since = new Date(now.getTime() - DAY_MS);
  const visible = workingProjectsWhere(user as CurrentUser);
  const live = { project: visible, archivedAt: null };
  const [created, done, comments, assigned, due] = await Promise.all([
    db.task.findMany({ where: { ...live, createdAt: { gte: since } }, orderBy: { createdAt: "desc" }, take: MAX_ROWS, select: taskSelect }),
    db.taskEvent.findMany({ where: { code: "done", createdAt: { gte: since }, task: live }, orderBy: { createdAt: "desc" }, take: MAX_ROWS, select: { task: { select: taskSelect } } }),
    db.taskComment.findMany({ where: { createdAt: { gte: since }, OR: [{ authorId: null }, { authorId: { not: user.id } }], task: live }, orderBy: { createdAt: "desc" }, take: MAX_ROWS, select: { task: { select: taskSelect } } }),
    db.notification.findMany({ where: { userId: user.id, type: "ASSIGNED", createdAt: { gte: since }, task: live }, orderBy: { createdAt: "desc" }, take: MAX_ROWS, select: { task: { select: taskSelect } } }),
    db.task.findMany({
      where: { ...live, assigneeId: user.id, column: { isDone: false }, dueDate: { lte: isoToDate(today) } },
      orderBy: [{ dueDate: "asc" }, { position: "asc" }],
      take: MAX_ROWS,
      select: { ...taskSelect, dueDate: true },
    }),
  ]);
  const out = emptyDigestInput();
  out.created = created.map((t) => item(t));
  out.done = done.map((e) => item(e.task));
  out.assigned = assigned.flatMap((n) => (n.task ? [item(n.task)] : []));
  const counts = new Map<string, DigestItem>();
  for (const c of comments) {
    const prev = counts.get(c.task.id);
    if (prev) prev.count = (prev.count ?? 1) + 1;
    else counts.set(c.task.id, item(c.task, { count: 1 }));
  }
  out.comments = [...counts.values()];
  for (const task of due) (task.dueDate!.toISOString().slice(0, 10) === today ? out.dueToday : out.overdue).push(item(task));
  return out;
}

/** Envía el resumen diario a quien lo tiene activado, ya es su hora y hoy no lo ha recibido. Devuelve cuántos ha enviado. */
export async function sendDueDigests(now: Date = new Date()): Promise<number> {
  if (!emailEnabled()) return 0;
  const tz = appTimeZone();
  const users = await db.user.findMany({
    where: { active: true, dailyDigest: true },
    select: { id: true, name: true, email: true, locale: true, role: true, digestHour: true, lastDigestAt: true },
  });
  let sent = 0;
  for (const u of users) {
    if (!digestDue(now, tz, { hour: u.digestHour, lastSentAt: u.lastDigestAt })) continue;
    // Reserva del envío: si otro proceso se adelantó, no hace nada.
    const claim = await db.user.updateMany({ where: { id: u.id, lastDigestAt: u.lastDigestAt }, data: { lastDigestAt: now } });
    if (claim.count !== 1) continue;
    const t0 = performance.now();
    try {
      const digest = buildDigest(await gatherDigest(u, now, todayIso(tz)));
      if (digest.empty) continue; // sin novedades no se manda nada (el día queda reservado)
      const t: T = makeT(toLocale(u.locale));
      await sendMail({ to: u.email, ...digestEmail(digest, { name: u.name, baseUrl: appUrl() }, t) });
      sent++;
      logEvent({ category: "notify", action: "digest.sent", message: `Resumen diario enviado a ${u.name}`, userId: u.id, userName: u.name, durationMs: performance.now() - t0 });
    } catch (err) {
      await db.user.updateMany({ where: { id: u.id, lastDigestAt: now }, data: { lastDigestAt: u.lastDigestAt } });
      logEvent({ level: "error", category: "notify", action: "digest.failed", message: `Fallo al enviar el resumen diario a ${u.name}: ${(err as Error).message}`, userId: u.id, userName: u.name, durationMs: performance.now() - t0 });
    }
  }
  return sent;
}

/** Correo del informe semanal: el PDF va adjunto. */
export function reportMail(opts: { projectName: string; url: string }, t: T) {
  const subject = t("Informe semanal de «{project}»", { project: opts.projectName });
  const intro = t("Adjuntamos el informe PDF de estado del proyecto «{project}».", { project: opts.projectName });
  const note = t("Recibes este correo porque alguien configuró el informe semanal en los ajustes del proyecto.");
  const text = `${intro}\n\n${t("Abrir el proyecto")}: ${opts.url}\n\n${note}\n`;
  const html = `<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;font-size:15px;color:#0f172a;max-width:560px">
<p>${escapeHtml(intro)}</p>
<p><a href="${escapeHtml(opts.url)}" style="display:inline-block;background:#4f46e5;color:#fff;padding:9px 16px;border-radius:8px;text-decoration:none">${escapeHtml(t("Abrir el proyecto"))}</a></p>
<p style="color:#94a3b8;font-size:12px">${escapeHtml(note)}</p></div>`;
  return { subject, text, html };
}

/** Envía los informes semanales cuyo día y hora han llegado. Devuelve cuántos ha enviado. */
export async function sendDueReports(now: Date = new Date()): Promise<number> {
  if (!emailEnabled()) return 0;
  const tz = appTimeZone();
  const schedules = await db.reportSchedule.findMany({ where: { enabled: true } });
  let sent = 0;
  for (const s of schedules) {
    if (!reportDue(now, tz, s)) continue;
    // La persona que lo configuró debe seguir activa y con acceso al proyecto (si no, no se manda nada de un proyecto que ya no ve).
    const creator = s.createdById ? await db.user.findFirst({ where: { id: s.createdById, active: true }, select: { id: true, name: true, role: true, locale: true } }) : null;
    const allowed = creator ? await db.project.count({ where: { id: s.projectId, ...visibleProjectsWhere(creator as CurrentUser) } }) : 0;
    // El destinatario también se comprueba al enviar: pudo perder el acceso después de programarlo.
    const recipientOk = creator && allowed ? await reportRecipientAllowed(s.projectId, s.recipient, creator.role) : false;
    if (!creator || !allowed || !recipientOk) {
      await db.reportSchedule.update({ where: { projectId: s.projectId }, data: { enabled: false } });
      logEvent({ level: "warn", category: "notify", action: "report.scheduleDisabled", message: "Informe semanal desactivado: quien lo configuró o su destinatario ya no tiene acceso al proyecto", projectId: s.projectId });
      continue;
    }
    const claim = await db.reportSchedule.updateMany({ where: { projectId: s.projectId, lastSentAt: s.lastSentAt }, data: { lastSentAt: now } });
    if (claim.count !== 1) continue;
    const t0 = performance.now();
    const base = { category: "notify", userId: creator.id, userName: creator.name, projectId: s.projectId };
    try {
      const locale = toLocale(creator.locale);
      const report = await generateProjectReportPdf(s.projectId, { generatedBy: creator.name, locale });
      if (!report) throw new Error("proyecto no encontrado");
      const mail = reportMail({ projectName: report.project.name, url: `${appUrl()}/p/${s.projectId}` }, makeT(locale));
      await sendMail({ to: s.recipient, ...mail, attachments: [{ filename: report.filename, content: Buffer.from(report.pdf), contentType: "application/pdf" }] });
      sent++;
      logEvent({ ...base, action: "report.scheduledSent", message: `Informe semanal de «${report.project.name}» enviado a ${s.recipient}`, durationMs: performance.now() - t0, details: { to: s.recipient, bytes: report.pdf.length, locale: intlLocale(locale) } });
    } catch (err) {
      await db.reportSchedule.updateMany({ where: { projectId: s.projectId, lastSentAt: now }, data: { lastSentAt: s.lastSentAt } });
      logEvent({ ...base, level: "error", action: "report.scheduledFailed", message: `Fallo al enviar el informe semanal a ${s.recipient}: ${(err as Error).message}`, durationMs: performance.now() - t0, details: { to: s.recipient } });
    }
  }
  return sent;
}
