import "server-only";
import { randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { after } from "next/server";
import nodemailer from "nodemailer";
import { logEvent } from "./log";
import { getInstanceSettings } from "./instance";
import { loadMailConfig, peekMailConfig, savedMailEnabled } from "./mail-config";
import { withSenderName, type MailConfig } from "./mail-settings-core";
import { logMailError, maskEmailsIn } from "./mask-email";
import { onShutdown, trackInFlight } from "./shutdown";

// Envío de emails: SMTP con nodemailer. La configuración sale de las variables SMTP_* del servidor o, si no hay, de lo
// que un administrador guarda en Administración → Integraciones (lib/mail-config.ts). Con MAIL_OUTBOX_DIR (solo desarrollo y
// pruebas) cada email se guarda como JSON en esa carpeta en vez de enviarse.

let outboxWarned = false;

/**
 * Carpeta del buzón de pruebas, o null si no se usa. En producción se ignora (los enlaces de acceso y los
 * códigos acabarían en disco y nadie recibiría los emails) salvo que MAIL_OUTBOX_IN_PRODUCTION=1 lo permita
 * explícitamente (p. ej. pruebas locales con `npm start`); al ignorarla se avisa en el registro.
 */
export function outboxDir(env: NodeJS.ProcessEnv = process.env): string | null {
  const dir = env.MAIL_OUTBOX_DIR?.trim();
  if (!dir) return null;
  if (env.NODE_ENV !== "production" || env.MAIL_OUTBOX_IN_PRODUCTION === "1") return dir;
  if (!outboxWarned && env === process.env) {
    outboxWarned = true;
    const message = "MAIL_OUTBOX_DIR está definida en producción y se ignora: los emails se envían por SMTP (o no se envían si no hay SMTP). Quítala de las variables del servicio.";
    console.error(`[mail] ${message}`);
    logEvent({ level: "error", category: "system", action: "mail.outboxIgnored", message });
  }
  return null;
}

export function emailEnabled(): boolean {
  return Boolean(outboxDir() || savedMailEnabled());
}

/** URL pública de la app; todos los enlaces de los emails salen de aquí, nunca de la petición. */
export function appUrl(): string {
  return (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
}

export { escapeHtml } from "./html-escape";

/** Pie de los avisos, el resumen y el informe: la dirección del remitente no la lee nadie. */
export const noReplyNote = (t: (key: string) => string): string => t("No respondas a este email: contesta en Pizarro.");

interface Transport {
  t: ReturnType<typeof nodemailer.createTransport>;
  signature: string;
  /** Envíos en curso por este transporte (en su cola o en la conexión). */
  sending: number;
  /** Sustituido (otra configuración) o cerrado al apagar: se cierra en cuanto termina su último envío. */
  retired: boolean;
}

// En globalThis: instrumentation.ts (el apagado) y las rutas se compilan en paquetes distintos y deben ver el mismo.
const mailState = ((globalThis as unknown as { __pzMailTransport?: { current: Transport | null } }).__pzMailTransport ??= { current: null });

/** Cierra el transporte si ya no se usa: los envíos que esperan en su cola salen antes (cerrarlo los haría fallar). */
function closeIfDone(tr: Transport): void {
  if (tr.retired && tr.sending === 0) tr.t.close();
}

function retire(tr: Transport): void {
  tr.retired = true;
  closeIfDone(tr);
}

/**
 * Transporte de nodemailer con una conexión SMTP que se reutiliza (`pool`, una sola: los servidores de correo limitan
 * las conexiones a la vez y los envíos van en fila). Antes cada email abría su conexión, con su TLS y su AUTH. Si el
 * servidor la cierra (o se cae), nodemailer la quita y abre otra con el siguiente envío; un email cuya conexión se cierra
 * a medias vuelve a la cola, y la que lleva 4 min sin usarse la cierra nodemailer antes de que lo haga el servidor. Se
 * rehace cuando cambia la configuración (al guardar los ajustes o cambiar las variables) y se cierra al apagar.
 */
function mailer(c: MailConfig): Transport {
  const signature = JSON.stringify(c);
  const cur = mailState.current;
  if (cur && cur.signature === signature) return cur;
  if (cur) retire(cur);
  const t = nodemailer.createTransport({
    pool: true,
    maxConnections: 1,
    host: c.host,
    port: c.port,
    secure: c.secure,
    requireTLS: c.requireTLS,
    auth: c.user ? { user: c.user, pass: c.pass } : undefined,
    connectionTimeout: 10_000,
    socketTimeout: 15_000,
  });
  // Un fallo de la conexión ya llega al envío que la usaba; esto solo evita un «error» sin escuchar.
  t.on("error", (err) => logMailError("[mail] conexión SMTP", err));
  return (mailState.current = { t, signature, sending: 0, retired: false });
}

/** Cierra la conexión SMTP (al apagar): los envíos en curso terminan antes. El siguiente envío abriría otra. */
export function closeMailTransport(): void {
  const cur = mailState.current;
  if (!cur) return;
  mailState.current = null;
  retire(cur);
}

onShutdown("mail", closeMailTransport);

export interface MailAttachment {
  filename: string;
  content: Buffer;
  contentType?: string;
}

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
  attachments?: MailAttachment[];
}

/**
 * Cabeceras de todo email de Pizarro: lo envía un programa, no una persona (RFC 3834). Así los contestadores automáticos
 * («Estoy de vacaciones…») no responden y Outlook/Exchange no manda sus respuestas automáticas a la dirección del
 * remitente, que nadie lee.
 */
const AUTO_MAIL_HEADERS: Readonly<Record<string, string>> = { "Auto-Submitted": "auto-generated", "X-Auto-Response-Suppress": "All" };

/** Remitente efectivo: sin nombre configurado, el de la organización (Administración → Ajustes) o «Pizarro». */
async function senderOf(from: string): Promise<string> {
  if (!from || from.includes("<")) return from;
  return withSenderName(from, (await getInstanceSettings()).orgName);
}

/** Envía un email; lanza si falla. El apagado ordenado del servidor espera a los envíos en curso (lib/shutdown.ts). */
export function sendMail(m: MailMessage): Promise<void> {
  return trackInFlight(() => deliverMail(m));
}

async function deliverMail(m: MailMessage): Promise<void> {
  const dir = outboxDir();
  // Con el buzón de pruebas no se toca la BD: solo se anota el remitente conocido.
  const config = dir ? peekMailConfig() : await loadMailConfig();
  if (dir) {
    // Llevan enlaces y códigos de acceso: solo legibles por el usuario del proceso.
    await mkdir(dir, { recursive: true, mode: 0o700 });
    const base = `${Date.now()}-${randomBytes(4).toString("hex")}`;
    // Los adjuntos se guardan como ficheros junto al JSON (que solo anota nombre y tamaño).
    const { attachments, ...rest } = m;
    const saved: { filename: string; bytes: number; file: string }[] = [];
    for (const [i, a] of (attachments ?? []).entries()) {
      const file = `${base}-${i}.attachment`;
      await writeFile(join(dir, file), a.content, { mode: 0o600 });
      saved.push({ filename: a.filename, bytes: a.content.length, file });
    }
    await writeFile(join(dir, `${base}.json`), JSON.stringify({ from: config.from || null, headers: AUTO_MAIL_HEADERS, ...rest, ...(saved.length ? { attachments: saved } : {}), createdAt: new Date().toISOString() }, null, 2), { mode: 0o600 });
    return;
  }
  if (!config.host) throw new Error("El envío de emails no está configurado.");
  const from = await senderOf(config.from);
  const tr = mailer(config);
  tr.sending++;
  try {
    await tr.t.sendMail({ from, headers: { ...AUTO_MAIL_HEADERS }, ...m });
  } finally {
    tr.sending--;
    closeIfDone(tr);
  }
}

/**
 * Envía un email tras responder a la persona (los avisos no deben alargar la petición ni delatar
 * si existe una cuenta). Los fallos solo se registran.
 */
export function sendMailInBackground(label: string, send: () => Promise<void>): void {
  const run = () => trackInFlight(runSend);
  const runSend = async () => {
    try {
      await send();
      logEvent({ category: "auth", action: "auth.emailSent", message: `Email enviado: ${label}` });
    } catch (err) {
      logMailError(`[mail] ${label}`, err);
      logEvent({ level: "error", category: "auth", action: "auth.emailFailed", message: `Fallo al enviar el email (${label}): ${maskEmailsIn((err as Error).message)}` });
    }
  };
  try {
    after(run);
  } catch {
    void run();
  }
}
