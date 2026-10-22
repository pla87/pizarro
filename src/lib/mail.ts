import "server-only";
import { randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { after } from "next/server";
import nodemailer from "nodemailer";
import { logEvent } from "./log";

// Envío de emails: SMTP con nodemailer. Con MAIL_OUTBOX_DIR (solo desarrollo y pruebas) cada email se
// guarda como JSON en esa carpeta en vez de enviarse.

export function emailEnabled(): boolean {
  return Boolean(process.env.MAIL_OUTBOX_DIR || (process.env.SMTP_HOST && process.env.SMTP_FROM));
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

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

/** Envía un email; lanza si falla. */
export async function sendMail(m: MailMessage): Promise<void> {
  const dir = process.env.MAIL_OUTBOX_DIR;
  if (dir) {
    await mkdir(dir, { recursive: true });
    const file = join(dir, `${Date.now()}-${randomBytes(4).toString("hex")}.json`);
    await writeFile(file, JSON.stringify({ from: process.env.SMTP_FROM ?? null, ...m, createdAt: new Date().toISOString() }, null, 2));
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
      console.error("[mail]", label, err);
      logEvent({ level: "error", category: "auth", action: "auth.emailFailed", message: `Fallo al enviar el email (${label}): ${(err as Error).message}` });
    }
  };
  try {
    after(run);
  } catch {
    void run();
  }
}
