import "server-only";
import { reportRecipientAllowed } from "./report-recipient";
import { intlLocale, makeT, toLocale, type T } from "../i18n/core";
import { visibleProjectsWhere, workingProjectsWhere } from "./access";
import { appTimeZone } from "./board";
import { isoToDate, todayIso } from "./dates";
import { db } from "./db";
import { buildDigest, digestEmail, digestPeriod, emptyDigestInput, type DigestInput, type DigestItem } from "./digest";
import { logEvent, logText } from "./log";
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

/** Códigos de nodemailer de un servidor de correo que no responde o no acepta el acceso (no de un email en concreto). */
const SMTP_DOWN_CODES = new Set(["ECONNECTION", "ETIMEDOUT", "ESOCKET", "EAUTH", "EDNS"]);

/**
 * ¿Falló el envío porque el SMTP no responde o rechaza el acceso? Entonces los demás envíos de la pasada fallarían igual:
 * se corta (cada uno esperaba hasta 10 s a la conexión y, el informe, generaba antes su PDF). Lo pendiente sale en la
 * pasada siguiente, porque la reserva ya se devolvió. Solo se mira con el error de sendMail: un ETIMEDOUT de la base al
 * reunir los datos no es del SMTP.
 */
const smtpDown = (err: unknown): boolean => SMTP_DOWN_CODES.has(String((err as { code?: unknown } | null)?.code ?? ""));

/**
 * ¿Rechazó el servidor de correo para siempre al destinatario (un buzón que no existe, un dominio que no acepta correo…)?
 * Solo cuenta la fase RCPT TO con una respuesta 5xx (nodemailer pone `command` en sus errores) y la dirección que
 * nodemailer no acepta antes de enviar (EENVELOPE sin respuesta del servidor). Reintentarlo en una hora daría lo mismo.
 * Lo demás es de la instalación y se reintenta cada hora: el remitente rechazado (MAIL FROM 530/553, p. ej. un SMTP_FROM
 * que el servidor no admite, o el que nodemailer no acepta), el mensaje rechazado en DATA y el acceso (EAUTH, con
 * smtpDown). Un 4xx (p. ej. una lista gris) es temporal.
 */
export function smtpRejected(err: unknown): boolean {
  if (smtpDown(err)) return false;
  const e = err as { code?: unknown; responseCode?: unknown; command?: unknown; message?: unknown } | null;
  if (e?.code !== "EENVELOPE") return false;
  const status = typeof e.responseCode === "number" ? e.responseCode : 0;
  if (e.command === "RCPT TO") return status >= 500 && status < 600;
  // Sin respuesta del servidor: la dirección del destinatario no vale (nodemailer: «Invalid recipient …», «No recipients
  // defined»); la del remitente («Invalid sender …») es de la configuración.
  return !status && e.command !== "MAIL FROM" && !/^Invalid sender/.test(String(e.message ?? ""));
}

function logSmtpDown(what: string, err: unknown): void {
  logEvent({ level: "warn", category: "notify", action: "mail.smtpDown", label: { k: "SMTP sin respuesta ({what}): {error}. Lo pendiente se intentará en la siguiente pasada.", p: { what: logText(what), error: logText(maskEmailsIn((err as Error).message)) } } });
}

// Si un envío falla (SMTP caído, PDF atascado…), no se reintenta en cada pasada del mantenimiento: como mucho una vez
// por hora y proyecto (informe) o persona (resumen). Así, si el correo de alguien falla siempre (con el SMTP caído, la
// pasada se corta en él), la pasada siguiente lo salta y sigue con los de detrás. Se guarda en memoria; al reiniciar el
// servidor se vuelve a intentar.
export const REPORT_RETRY_MS = 60 * 60 * 1000;

function failureMemory() {
  const failedAt = new Map<string, number>();
  return {
    /** ¿Se puede (re)intentar ya? */
    allowed(key: string, now: Date): boolean {
      const at = failedAt.get(key);
      return at === undefined || now.getTime() - at >= REPORT_RETRY_MS;
    },
    note: (key: string, now: Date) => void failedAt.set(key, now.getTime()),
    clear: (key: string) => void failedAt.delete(key),
  };
}

const reportFailures = failureMemory();
const digestFailures = failureMemory();
/** ¿Se puede (re)intentar ya el informe de este proyecto? */
export const reportRetryAllowed = reportFailures.allowed;
export const noteReportFailure = reportFailures.note;
export const clearReportFailure = reportFailures.clear;

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
    if (!digestFailures.allowed(u.id, now)) continue;
    if (isShuttingDown()) break;
    const result = await trackInFlight(() => sendDigest(u, now, tz));
    if (result === true) sent++;
    else if (result !== false) {
      logSmtpDown("resumen diario", result.smtpDown);
      break;
    }
  }
  return sent;
}

type DigestUser = { id: string; name: string; email: string; locale: string | null; role: "ADMIN" | "MEMBER"; lastDigestAt: Date | null };

/**
 * Reserva, reúne y envía el resumen de una persona (o devuelve la reserva si falla). true si se ha enviado; si el envío
 * falló con el SMTP caído, `{ smtpDown }` con el error para cortar la pasada (un error de la base al reunir los datos,
 * aunque sea también un ETIMEDOUT, no corta nada).
 */
async function sendDigest(u: DigestUser, now: Date, tz: string): Promise<boolean | { smtpDown: unknown }> {
  // Reserva del envío: si otro proceso se adelantó, no hace nada.
  const claim = await db.user.updateMany({ where: { id: u.id, lastDigestAt: u.lastDigestAt }, data: { lastDigestAt: now } });
  if (claim.count !== 1) return false;
  const t0 = performance.now();
  let sending = false;
  try {
    const digest = buildDigest(await gatherDigest(u, now, todayIso(tz, now), u.lastDigestAt));
    if (digest.empty) return false; // sin novedades no se manda nada (el día queda reservado)
    const t: T = makeT(toLocale(u.locale));
    const unsub = unsubscribeLinks("digest", u.id, u.email);
    sending = true;
    await sendMail({ to: u.email, ...digestEmail(digest, { name: u.name, baseUrl: appUrl(), period: digestPeriod(u.lastDigestAt, now), unsubscribeUrl: unsub.page }, t), headers: unsub.headers });
    sending = false;
    digestFailures.clear(u.id);
    logEvent({ category: "notify", action: "digest.sent", label: { k: "Resumen diario enviado a {name}", p: { name: u.name } }, userId: u.id, userName: u.name, durationMs: performance.now() - t0 });
    return true;
  } catch (err) {
    digestFailures.note(u.id, now);
    await db.user.updateMany({ where: { id: u.id, lastDigestAt: now }, data: { lastDigestAt: u.lastDigestAt } });
    logEvent({ level: "error", category: "notify", action: "digest.failed", label: { k: "Fallo al enviar el resumen diario a {name}: {error}", p: { name: u.name, error: logText(maskEmailsIn((err as Error).message)) } }, userId: u.id, userName: u.name, durationMs: performance.now() - t0 });
    return sending && smtpDown(err) ? { smtpDown: err } : false;
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

/**
 * Aviso a quien configuró el informe de que el servidor de correo rechaza al destinatario: el nombre de la persona de
 * Pizarro si lo es (quien lo configuró puede no ver su email) y, si no, la dirección (externa: solo la pone un
 * administrador). Sin la respuesta del servidor de correo.
 */
function reportRejectedMail(opts: { name: string; projectName: string; recipient: string; url: string }, t: T) {
  const subject = t("No se ha podido enviar el informe semanal de «{project}»", { project: opts.projectName });
  const paragraphs = [
    t("Hola, {name}:", { name: opts.name }),
    t("El informe semanal del proyecto «{project}» no se ha enviado esta vez: el servidor de correo no acepta la dirección de {recipient}.", { project: opts.projectName, recipient: opts.recipient }),
    t("Comprueba el destinatario en los ajustes del proyecto (Informe semanal por email). Si no cambia, se volverá a intentar el día y a la hora de siempre."),
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
      logEvent({ level: "warn", category: "notify", action: "report.scheduleDisabled", label: { k: "Informe semanal desactivado: quien lo configuró o su destinatario ya no tiene acceso al proyecto" }, projectId: s.projectId });
      continue;
    }
    if (isShuttingDown()) break;
    const result = await trackInFlight(() => sendReport(s, creator, now, opts.generate ?? generateProjectReportPdf));
    if (result === true) sent++;
    else if (result !== false) {
      // Los demás informes no generan su PDF para nada: salen en la pasada siguiente.
      logSmtpDown("informe semanal", result.smtpDown);
      break;
    }
  }
  return sent;
}

type Schedule = { projectId: string; recipient: string; lastSentAt: Date | null };
type Creator = { id: string; name: string; email: string; locale: string | null };

/**
 * Reserva, genera y envía un informe semanal (o devuelve la reserva si falla). true si se ha enviado; si el envío falló
 * con el SMTP caído, `{ smtpDown }` con el error para cortar la pasada. Va en el idioma
 * del destinatario si es una persona de Pizarro; a una dirección externa, en el de quien lo configuró.
 */
async function sendReport(s: Schedule, creator: Creator, now: Date, generate: GenerateReport): Promise<boolean | { smtpDown: unknown }> {
  const claim = await db.reportSchedule.updateMany({ where: { projectId: s.projectId, lastSentAt: s.lastSentAt }, data: { lastSentAt: now } });
  if (claim.count !== 1) return false;
  const t0 = performance.now();
  const base = { category: "notify", userId: creator.id, userName: creator.name, projectId: s.projectId };
  const url = `${appUrl()}/p/${s.projectId}`;
  let sending = false;
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
    sending = true;
    await sendMail({ to: s.recipient, ...mail, headers: unsub.headers, attachments: [{ filename: report.filename, content: Buffer.from(report.pdf), contentType: "application/pdf" }] });
    sending = false;
    clearReportFailure(s.projectId);
    logEvent({ ...base, action: "report.scheduledSent", label: { k: "Informe semanal de «{project}» enviado a {to}", p: { project: report.project.name, to: maskEmail(s.recipient) } }, durationMs: performance.now() - t0, details: { to: maskEmail(s.recipient), bytes: report.pdf.length, locale: intlLocale(locale) } });
    return true;
  } catch (err) {
    if (pdfOutOfMemory(err)) {
      // Sin memoria para el PDF: reintentarlo cada hora volvería a fallar y ocuparía la cola de PDF todo el día. Se deja
      // la reserva (ya no se intenta más hasta el próximo envío, tampoco en otro proceso) y se avisa una vez a quien lo
      // configuró.
      clearReportFailure(s.projectId);
      logEvent({ ...base, level: "error", action: "report.scheduledTooLarge", label: { k: "Informe semanal no enviado a {to}: {error}. No se reintenta hasta el próximo envío; se avisa a quien lo configuró", p: { to: maskEmail(s.recipient), error: logText(maskEmailsIn((err as Error).message)) } }, durationMs: performance.now() - t0, details: { to: maskEmail(s.recipient) } });
      await notifyReportTooLarge(s.projectId, creator, url);
      return false;
    }
    if (sending && smtpRejected(err)) {
      // El servidor de correo rechaza al destinatario para siempre: reintentarlo cada hora volvería a generar
      // el PDF para nada hasta medianoche. Como sin memoria para el PDF, se deja la reserva hasta el próximo envío.
      clearReportFailure(s.projectId);
      logEvent({ ...base, level: "error", action: "report.scheduledRejected", label: { k: "Informe semanal no enviado a {to}: el servidor de correo lo rechaza ({error}). No se reintenta hasta el próximo envío", p: { to: maskEmail(s.recipient), error: logText(maskEmailsIn((err as Error).message)) } }, durationMs: performance.now() - t0, details: { to: maskEmail(s.recipient) } });
      await notifyReportRejected(s, creator, url, now);
      return false;
    }
    noteReportFailure(s.projectId, now);
    await db.reportSchedule.updateMany({ where: { projectId: s.projectId, lastSentAt: now }, data: { lastSentAt: s.lastSentAt } });
    logEvent({ ...base, level: "error", action: "report.scheduledFailed", label: { k: "Fallo al enviar el informe semanal a {to}: {error}", p: { to: maskEmail(s.recipient), error: logText(maskEmailsIn((err as Error).message)) } }, durationMs: performance.now() - t0, details: { to: maskEmail(s.recipient) } });
    return sending && smtpDown(err) ? { smtpDown: err } : false;
  }
}

/** Email a quien configuró el informe de que no ha salido por su tamaño (en su idioma). Un fallo solo se registra. */
async function notifyReportTooLarge(projectId: string, creator: Creator, url: string): Promise<void> {
  const base = { category: "notify", userId: creator.id, userName: creator.name, projectId };
  try {
    const project = await db.project.findUnique({ where: { id: projectId }, select: { name: true } });
    if (!project) return;
    await sendMail({ to: creator.email, ...reportTooLargeMail({ name: creator.name, projectName: project.name, url }, makeT(toLocale(creator.locale))) });
    logEvent({ ...base, action: "report.tooLargeNotified", label: { k: "Aviso a {name}: el informe semanal de «{project}» es demasiado grande", p: { name: creator.name, project: project.name } }, details: { to: maskEmail(creator.email) } });
  } catch (err) {
    logEvent({ ...base, level: "error", action: "report.tooLargeNotifyFailed", label: { k: "Fallo al avisar a {name} del informe demasiado grande: {error}", p: { name: creator.name, error: logText(maskEmailsIn((err as Error).message)) } } });
  }
}

/** Como mucho un aviso de destinatario rechazado por proyecto y semana. */
const REJECTED_NOTICE_GAP_MS = 7 * DAY_MS;

/**
 * Email a quien configuró el informe de que el servidor de correo rechaza a su destinatario (en su idioma), como mucho
 * una vez por semana y proyecto: el último aviso se busca en los Logs («report.rejectedNotified»; con LOG_RETENTION_DAYS
 * por debajo de 7 podría repetirse antes si se cambia el día del informe). Un fallo solo se registra.
 */
async function notifyReportRejected(s: Schedule, creator: Creator, url: string, now: Date): Promise<void> {
  const base = { category: "notify", userId: creator.id, userName: creator.name, projectId: s.projectId };
  // Quien se programó el informe a sí mismo: el aviso iría a la misma dirección rechazada y volvería a fallar cada
  // semana (el rechazo ya queda en los Logs como «report.scheduledRejected»).
  if (creator.email.trim().toLowerCase() === s.recipient.trim().toLowerCase()) return;
  try {
    // Con la categoría, la consulta usa el índice [category, createdAt] en vez de recorrer toda la semana de Logs.
    const recent = await db.appLog.count({ where: { category: "notify", action: "report.rejectedNotified", projectId: s.projectId, createdAt: { gt: new Date(now.getTime() - REJECTED_NOTICE_GAP_MS) } } });
    if (recent) return;
    const [project, person] = await Promise.all([
      db.project.findUnique({ where: { id: s.projectId }, select: { name: true } }),
      db.user.findFirst({ where: { email: { equals: s.recipient, mode: "insensitive" } }, select: { name: true } }),
    ]);
    if (!project) return;
    const t = makeT(toLocale(creator.locale));
    await sendMail({ to: creator.email, ...reportRejectedMail({ name: creator.name, projectName: project.name, recipient: person?.name ?? s.recipient, url }, t) });
    logEvent({ ...base, action: "report.rejectedNotified", label: { k: "Aviso a {name}: el servidor de correo rechaza al destinatario del informe semanal de «{project}»", p: { name: creator.name, project: project.name } }, details: { to: maskEmail(creator.email) } });
  } catch (err) {
    logEvent({ ...base, level: "error", action: "report.rejectedNotifyFailed", label: { k: "Fallo al avisar a {name} del destinatario rechazado: {error}", p: { name: creator.name, error: logText(maskEmailsIn((err as Error).message)) } } });
  }
}
