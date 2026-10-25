import "server-only";
import { randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { after } from "next/server";
import nodemailer from "nodemailer";
import { logEvent } from "./log";
import { maskEmailsIn } from "./mask-email";

// Envío de emails: SMTP con nodemailer. Con MAIL_OUTBOX_DIR (solo desarrollo y pruebas) cada email se
// guarda como JSON en esa carpeta en vez de enviarse.

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
  return Boolean(outboxDir() || (process.env.SMTP_HOST && process.env.SMTP_FROM));
}

/** URL pública de la app; todos los enlaces de los emails salen de aquí, nunca de la petición. */
export function appUrl(): string {
  return (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
}

export const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

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

/** Envía un email; lanza si falla. */
export async function sendMail(m: MailMessage): Promise<void> {
  const dir = outboxDir();
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
    await writeFile(join(dir, `${base}.json`), JSON.stringify({ from: process.env.SMTP_FROM ?? null, ...rest, ...(saved.length ? { attachments: saved } : {}), createdAt: new Date().toISOString() }, null, 2), { mode: 0o600 });
    return;
  }
  await mailer().sendMail({ from: process.env.SMTP_FROM, ...m });
}

/**
 * Envía un email tras responder a la persona (los avisos no deben alargar la petición ni delatar
 * si existe una cuenta). Los fallos solo se registran.
 */
export function sendMailInBackground(label: string, send: () => Promise<void>): void {
  const run = async () => {
    try {
      await send();
      logEvent({ category: "auth", action: "auth.emailSent", message: `Email enviado: ${label}` });
    } catch (err) {
      console.error("[mail]", label, maskEmailsIn(String(err)));
      logEvent({ level: "error", category: "auth", action: "auth.emailFailed", message: `Fallo al enviar el email (${label}): ${maskEmailsIn((err as Error).message)}` });
    }
  };
  try {
    after(run);
  } catch {
    void run();
  }
}
