import "server-only";
import { reportRecipientAllowed } from "./report-recipient";
import { intlLocale, makeT, toLocale, type T } from "../i18n/core";
import { visibleProjectsWhere, workingProjectsWhere } from "./access";
import { appTimeZone } from "./board";
import { isoToDate, todayIso } from "./dates";
import { db } from "./db";
import { buildDigest, digestEmail, digestPeriod, emptyDigestInput, type DigestInput, type DigestItem } from "./digest";
import { logEvent } from "./log";
import { maskEmail, maskEmailsIn } from "./mask-email";
import { appUrl, emailEnabled, escapeHtml, noReplyNote, sendMail, unsubscribeFooter } from "./mail";
import { unsubscribeLinks } from "./unsubscribe-links";
import { getInstanceSettings } from "./instance";
import { generateProjectReportPdf } from "./report-build";
import { WEEKLY_REPORT_LIST_LIMIT } from "./report";
import { PDF_OUT_OF_MEMORY_MESSAGE } from "./report-render";
import { digestDue, reportDue } from "./schedule";
import type { CurrentUser } from "./session";
import { isShuttingDown, trackInFlight } from "./shutdown";

// Envíos periódicos por email (resumen diario e informe semanal). Los lanza el mantenimiento cada hora;
// ver schedule.ts para cuándo toca cada uno. Se «reserva» el envío antes de hacerlo (compare-and-set de la
// fecha del último) para que dos procesos no manden el mismo correo, y se devuelve la reserva si falla.
// Reserva, envío y devolución van juntos como trabajo en curso (trackInFlight): un apagado a mitad (reunir los datos,
// generar el PDF) los espera dentro de su plazo en vez de salir con el día reservado y el correo sin mandar. Con el
// apagado ya en marcha no se reserva nada más (lo que quede sale en la primera pasada del proceso nuevo).

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_ROWS = 300;

const taskSelect = { id: true, title: true, project: { select: { id: true, name: true } } } as const;
type TaskRow = { id: string; title: string; project: { id: string; name: string } };
const item = (t: TaskRow, extra: Partial<DigestItem> = {}): DigestItem => ({ taskId: t.id, title: t.title, projectId: t.project.id, projectName: t.project.name, ...extra });

/**
 * Lo ocurrido desde el resumen anterior (o en las últimas 24 h) en los proyectos en los que trabaja la persona (los de sus menús: un admin, los
 * de equipo que eligió en su perfil y sus privados; ver workingProjectsWhere), y lo que le toca a ella en
 * cualquier proyecto que pueda ver.
 */
export async function gatherDigest(user: { id: string; role: "ADMIN" | "MEMBER" }, now: Date, today: string, lastSentAt: Date | null = null): Promise<DigestInput> {
  // Desde el envío anterior (así no se pierde ni se repite nada aunque salga a otra hora), como mucho 48 h atrás;
  // sin envío anterior, las últimas 24 h.
  const floor = now.getTime() - 2 * DAY_MS;
  const since = new Date(lastSentAt ? Math.min(now.getTime(), Math.max(lastSentAt.getTime(), floor)) : now.getTime() - DAY_MS);
  const working = workingProjectsWhere(user as CurrentUser);
  const live = { project: working, archivedAt: null };
  // Lo asignado a la persona sale aunque un admin no haya elegido ese proyecto (sigue pudiendo verlo).
  const mine = { project: visibleProjectsWhere(user as CurrentUser), archivedAt: null };
  const [created, done, comments, assigned, due] = await Promise.all([
    // «Tareas nuevas»: las que crearon otras personas (las suyas ya las conoce, como sus comentarios).
    db.task.findMany({ where: { ...live, createdAt: { gte: since }, OR: [{ createdById: null }, { createdById: { not: user.id } }] }, orderBy: { createdAt: "desc" }, take: MAX_ROWS, select: taskSelect }),
    // «Terminadas»: también las que se archivaron después de terminarlas (archivar lo terminado es lo normal antes del envío).
    db.taskEvent.findMany({ where: { code: "done", createdAt: { gte: since }, task: { project: working } }, orderBy: { createdAt: "desc" }, take: MAX_ROWS, select: { task: { select: taskSelect } } }),
    db.taskComment.findMany({ where: { deletedAt: null, createdAt: { gte: since }, OR: [{ authorId: null }, { authorId: { not: user.id } }], task: live }, orderBy: { createdAt: "desc" }, take: MAX_ROWS, select: { task: { select: taskSelect } } }),
    db.notification.findMany({ where: { userId: user.id, type: "ASSIGNED", createdAt: { gte: since }, task: mine }, orderBy: { createdAt: "desc" }, take: MAX_ROWS, select: { task: { select: taskSelect } } }),
    db.task.findMany({
      where: { ...mine, assigneeId: user.id, column: { isDone: false }, dueDate: { lte: isoToDate(today) } },
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
  // La zona horaria guardada en Ajustes (appTimeZone la lee de la copia en memoria que rellena getInstanceSettings).
  await getInstanceSettings();
  const tz = appTimeZone();
  const users = await db.user.findMany({
    where: { active: true, dailyDigest: true },
    select: { id: true, name: true, email: true, locale: true, role: true, digestHour: true, lastDigestAt: true },
  });
  let sent = 0;
  for (const u of users) {
    if (!digestDue(now, tz, { hour: u.digestHour, lastSentAt: u.lastDigestAt })) continue;
    if (isShuttingDown()) break;
    if (await trackInFlight(() => sendDigest(u, now, tz))) sent++;
  }
  return sent;
}

type DigestUser = { id: string; name: string; email: string; locale: string | null; role: "ADMIN" | "MEMBER"; lastDigestAt: Date | null };

/** Reserva, reúne y envía el resumen de una persona (o devuelve la reserva si falla). true si se ha enviado. */
async function sendDigest(u: DigestUser, now: Date, tz: string): Promise<boolean> {
  // Reserva del envío: si otro proceso se adelantó, no hace nada.
  const claim = await db.user.updateMany({ where: { id: u.id, lastDigestAt: u.lastDigestAt }, data: { lastDigestAt: now } });
  if (claim.count !== 1) return false;
  const t0 = performance.now();
  try {
    const digest = buildDigest(await gatherDigest(u, now, todayIso(tz, now), u.lastDigestAt));
    if (digest.empty) return false; // sin novedades no se manda nada (el día queda reservado)
    const t: T = makeT(toLocale(u.locale));
    const unsub = unsubscribeLinks("digest", u.id, u.email);
    await sendMail({ to: u.email, ...digestEmail(digest, { name: u.name, baseUrl: appUrl(), period: digestPeriod(u.lastDigestAt, now), unsubscribeUrl: unsub.page }, t), headers: unsub.headers });
    logEvent({ category: "notify", action: "digest.sent", label: { k: "Resumen diario enviado a {name}", p: { name: u.name } }, userId: u.id, userName: u.name, durationMs: performance.now() - t0 });
    return true;
  } catch (err) {
    await db.user.updateMany({ where: { id: u.id, lastDigestAt: now }, data: { lastDigestAt: u.lastDigestAt } });
    logEvent({ level: "error", category: "notify", action: "digest.failed", message: `Fallo al enviar el resumen diario a ${u.name}: ${maskEmailsIn((err as Error).message)}`, userId: u.id, userName: u.name, durationMs: performance.now() - t0 });
    return false;
  }
}

/** Correo del informe semanal: el PDF va adjunto. Dice de qué organización es y quién lo configuró. */
function reportMail(opts: { projectName: string; url: string; orgName: string; setBy: string; unsubscribeUrl: string }, t: T) {
  const subject = t("Informe semanal de «{project}»", { project: opts.projectName });
  const intro = opts.orgName
    ? t("Adjuntamos el informe PDF de estado del proyecto «{project}» de {org}.", { project: opts.projectName, org: opts.orgName })
    : t("Adjuntamos el informe PDF de estado del proyecto «{project}».", { project: opts.projectName });
  const note = t("Recibes este correo porque {name} configuró el informe semanal en los ajustes del proyecto.", { name: opts.setBy });
  const noReply = noReplyNote(t);
  const unsub = unsubscribeFooter(opts.unsubscribeUrl, t);
  const text = `${intro}\n\n${t("Abrir el proyecto")}: ${opts.url}\n\n${note}\n${unsub.text}${noReply}\n`;
  const html = `<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;font-size:15px;color:#0f172a;max-width:560px">
<p>${escapeHtml(intro)}</p>
<p><a href="${escapeHtml(opts.url)}" style="display:inline-block;background:#4f46e5;color:#fff;padding:9px 16px;border-radius:8px;text-decoration:none">${escapeHtml(t("Abrir el proyecto"))}</a></p>
<p style="color:#64748b;font-size:12px">${escapeHtml(note)}<br>${escapeHtml(noReply)}${unsub.html}</p></div>`;
  return { subject, text, html };
}

/**
 * Aviso a quien configuró el informe de que esta semana no ha salido porque el PDF no cabe en la memoria del generador
 * (proyecto con muchísimas tareas): qué pasa y qué puede hacer, sin tecnicismos.
 */
function reportTooLargeMail(opts: { name: string; projectName: string; url: string }, t: T) {
  const subject = t("No se ha podido enviar el informe semanal de «{project}»", { project: opts.projectName });
  const paragraphs = [
    t("Hola, {name}:", { name: opts.name }),
    t("El informe semanal del proyecto «{project}» no se ha enviado esta vez: el proyecto tiene tantas tareas que el PDF no cabe en la memoria que Pizarro reserva para generarlo.", { project: opts.projectName }),
    t("Para que vuelva a salir, haz el informe más corto: deja menos tareas pendientes (borra o termina las que ya no hagan falta) o archiva las tareas cerradas. El próximo informe se intentará el día y a la hora de siempre."),
    t("Si necesitas el informe tal como está, pide a un administrador que dé más memoria al generador de PDF (PDF_WORKER_MAX_MB)."),
  ];
  const open = t("Abrir el proyecto");
  const noReply = noReplyNote(t);
  const text = `${paragraphs.join("\n\n")}\n\n${open}: ${opts.url}\n\n${noReply}\n`;
  const html = `<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;font-size:15px;color:#0f172a;max-width:560px">
${paragraphs.map((p) => `<p>${escapeHtml(p)}</p>`).join("\n")}
<p><a href="${escapeHtml(opts.url)}" style="display:inline-block;background:#4f46e5;color:#fff;padding:9px 16px;border-radius:8px;text-decoration:none">${escapeHtml(open)}</a></p>
<p style="color:#64748b;font-size:12px">${escapeHtml(noReply)}</p></div>`;
  return { subject, text, html };
}

/** ¿Falló el PDF porque el generador se quedó sin memoria? (report-render.ts) */
function pdfOutOfMemory(err: unknown): boolean {
  const e = err as { message?: unknown; cause?: { code?: unknown } } | null;
  return (typeof e?.message === "string" && e.message.startsWith(PDF_OUT_OF_MEMORY_MESSAGE)) || e?.cause?.code === "ERR_WORKER_OUT_OF_MEMORY";
}

// Si el envío de un informe falla (SMTP caído, PDF atascado…), no se reintenta en cada pasada del mantenimiento:
// como mucho una vez por hora y proyecto. Se guarda en memoria; al reiniciar el servidor se vuelve a intentar.
export const REPORT_RETRY_MS = 60 * 60 * 1000;
const reportFailures = new Map<string, number>();

/** ¿Se puede (re)intentar ya el informe de este proyecto? */
export function reportRetryAllowed(projectId: string, now: Date): boolean {
  const failedAt = reportFailures.get(projectId);
  return failedAt === undefined || now.getTime() - failedAt >= REPORT_RETRY_MS;
}

export const noteReportFailure = (projectId: string, now: Date) => void reportFailures.set(projectId, now.getTime());
export const clearReportFailure = (projectId: string) => void reportFailures.delete(projectId);

type GenerateReport = typeof generateProjectReportPdf;

/**
 * Envía los informes semanales cuyo día y hora han llegado. Devuelve cuántos ha enviado. `generate`: quién hace el PDF
 * (las pruebas lo sustituyen para simular un fallo).
 */
export async function sendDueReports(now: Date = new Date(), opts: { generate?: GenerateReport } = {}): Promise<number> {
  if (!emailEnabled()) return 0;
  await getInstanceSettings();
  const tz = appTimeZone();
  const schedules = await db.reportSchedule.findMany({ where: { enabled: true } });
  let sent = 0;
  for (const s of schedules) {
    if (!reportDue(now, tz, s)) continue;
    if (!reportRetryAllowed(s.projectId, now)) continue;
    // La persona que lo configuró debe seguir activa y con acceso al proyecto (si no, no se manda nada de un proyecto que ya no ve).
    const creator = s.createdById ? await db.user.findFirst({ where: { id: s.createdById, active: true }, select: { id: true, name: true, email: true, role: true, locale: true } }) : null;
    const allowed = creator ? await db.project.count({ where: { id: s.projectId, ...visibleProjectsWhere(creator as CurrentUser) } }) : 0;
    // El destinatario también se comprueba al enviar: pudo perder el acceso después de programarlo.
    const recipientOk = creator && allowed ? await reportRecipientAllowed(s.projectId, s.recipient, creator.role) : false;
    if (!creator || !allowed || !recipientOk) {
      await db.reportSchedule.update({ where: { projectId: s.projectId }, data: { enabled: false } });
      logEvent({ level: "warn", category: "notify", action: "report.scheduleDisabled", message: "Informe semanal desactivado: quien lo configuró o su destinatario ya no tiene acceso al proyecto", projectId: s.projectId });
      continue;
    }
    if (isShuttingDown()) break;
    if (await trackInFlight(() => sendReport(s, creator, now, opts.generate ?? generateProjectReportPdf))) sent++;
  }
  return sent;
}

type Schedule = { projectId: string; recipient: string; lastSentAt: Date | null };
type Creator = { id: string; name: string; email: string; locale: string | null };

/**
 * Reserva, genera y envía un informe semanal (o devuelve la reserva si falla). true si se ha enviado. Va en el idioma
 * del destinatario si es una persona de Pizarro; a una dirección externa, en el de quien lo configuró.
 */
async function sendReport(s: Schedule, creator: Creator, now: Date, generate: GenerateReport): Promise<boolean> {
  const claim = await db.reportSchedule.updateMany({ where: { projectId: s.projectId, lastSentAt: s.lastSentAt }, data: { lastSentAt: now } });
  if (claim.count !== 1) return false;
  const t0 = performance.now();
  const base = { category: "notify", userId: creator.id, userName: creator.name, projectId: s.projectId };
  const url = `${appUrl()}/p/${s.projectId}`;
  try {
    const person = await db.user.findFirst({ where: { email: { equals: s.recipient, mode: "insensitive" }, active: true }, select: { locale: true } });
    const locale = toLocale(person ? person.locale : creator.locale);
    // Corto aunque el proyecto sea enorme: como mucho WEEKLY_REPORT_LIST_LIMIT tareas por listado, con «… y N más» y un
    // enlace al tablero (la descarga desde la app sigue con todas).
    const report = await generate(s.projectId, { generatedBy: creator.name, locale, listLimit: WEEKLY_REPORT_LIST_LIMIT, boardUrl: url });
    if (!report) throw new Error("proyecto no encontrado");
    const { orgName } = await getInstanceSettings();
    // La baja de este email apaga este informe (el destinatario puede no tener cuenta en Pizarro).
    const unsub = unsubscribeLinks("report", s.projectId, s.recipient);
    const mail = reportMail({ projectName: report.project.name, url, orgName, setBy: creator.name, unsubscribeUrl: unsub.page }, makeT(locale));
    await sendMail({ to: s.recipient, ...mail, headers: unsub.headers, attachments: [{ filename: report.filename, content: Buffer.from(report.pdf), contentType: "application/pdf" }] });
    clearReportFailure(s.projectId);
    logEvent({ ...base, action: "report.scheduledSent", message: `Informe semanal de «${report.project.name}» enviado a ${maskEmail(s.recipient)}`, durationMs: performance.now() - t0, details: { to: maskEmail(s.recipient), bytes: report.pdf.length, locale: intlLocale(locale) } });
    return true;
  } catch (err) {
    if (pdfOutOfMemory(err)) {
      // Sin memoria para el PDF: reintentarlo cada hora volvería a fallar y ocuparía la cola de PDF todo el día. Se deja
      // la reserva (ya no se intenta más hasta el próximo envío, tampoco en otro proceso) y se avisa una vez a quien lo
      // configuró.
      clearReportFailure(s.projectId);
      logEvent({ ...base, level: "error", action: "report.scheduledTooLarge", message: `Informe semanal no enviado a ${maskEmail(s.recipient)}: ${maskEmailsIn((err as Error).message)}. No se reintenta hasta el próximo envío; se avisa a quien lo configuró`, durationMs: performance.now() - t0, details: { to: maskEmail(s.recipient) } });
      await notifyReportTooLarge(s.projectId, creator, url);
      return false;
    }
    noteReportFailure(s.projectId, now);
    await db.reportSchedule.updateMany({ where: { projectId: s.projectId, lastSentAt: now }, data: { lastSentAt: s.lastSentAt } });
    logEvent({ ...base, level: "error", action: "report.scheduledFailed", message: `Fallo al enviar el informe semanal a ${maskEmail(s.recipient)}: ${maskEmailsIn((err as Error).message)}`, durationMs: performance.now() - t0, details: { to: maskEmail(s.recipient) } });
    return false;
  }
}

/** Email a quien configuró el informe de que no ha salido por su tamaño (en su idioma). Un fallo solo se registra. */
async function notifyReportTooLarge(projectId: string, creator: Creator, url: string): Promise<void> {
  const base = { category: "notify", userId: creator.id, userName: creator.name, projectId };
  try {
    const project = await db.project.findUnique({ where: { id: projectId }, select: { name: true } });
    if (!project) return;
    await sendMail({ to: creator.email, ...reportTooLargeMail({ name: creator.name, projectName: project.name, url }, makeT(toLocale(creator.locale))) });
    logEvent({ ...base, action: "report.tooLargeNotified", message: `Aviso a ${creator.name}: el informe semanal de «${project.name}» es demasiado grande`, details: { to: maskEmail(creator.email) } });
  } catch (err) {
    logEvent({ ...base, level: "error", action: "report.tooLargeNotifyFailed", message: `Fallo al avisar a ${creator.name} del informe demasiado grande: ${maskEmailsIn((err as Error).message)}` });
  }
}
