import "server-only";
import { intlLocale, makeT, toLocale, type T } from "../i18n/core";
import { formatDate } from "./format";
import { appUrl, escapeHtml, sendMail, type MailMessage } from "./mail";
import { TOKEN_TTL_MS } from "./auth-token-core";
import { EMAIL_CODE_TTL_MS } from "./two-factor-core";

// Emails de cuentas (enlaces y avisos de seguridad). Cada uno sale en el idioma del destinatario;
// los enlaces se construyen con APP_URL (ver appUrl en mail.ts) y todo el HTML va escapado.

export interface Recipient {
  name: string;
  email: string;
  locale: string;
}

interface Layout {
  paragraphs: string[];
  details?: [label: string, value: string][];
  button?: { label: string; url: string };
  note?: string;
}

/** Texto plano y HTML a partir de las mismas piezas: nada del contenido llega al HTML sin escapar. */
function render(layout: Layout): { text: string; html: string } {
  const text = [
    ...layout.paragraphs,
    ...(layout.details ? [layout.details.map(([l, v]) => `${l}: ${v}`).join("\n")] : []),
    ...(layout.button ? [`${layout.button.label}: ${layout.button.url}`] : []),
    ...(layout.note ? [layout.note] : []),
  ].join("\n\n") + "\n";
  const html = `<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;font-size:15px;color:#0f172a;max-width:560px">
${layout.paragraphs.map((p) => `<p>${escapeHtml(p)}</p>`).join("\n")}
${layout.details ? `<table style="margin:12px 0;border-collapse:collapse">${layout.details.map(([l, v]) => `<tr><td style="padding:2px 12px 2px 0;color:#64748b">${escapeHtml(l)}</td><td style="padding:2px 0">${escapeHtml(v)}</td></tr>`).join("")}</table>` : ""}
${layout.button ? `<p><a href="${escapeHtml(layout.button.url)}" style="display:inline-block;background:#4f46e5;color:#fff;padding:9px 16px;border-radius:8px;text-decoration:none">${escapeHtml(layout.button.label)}</a></p><p style="color:#64748b;font-size:12px;word-break:break-all">${escapeHtml(layout.button.url)}</p>` : ""}
${layout.note ? `<p style="color:#94a3b8;font-size:12px">${escapeHtml(layout.note)}</p>` : ""}</div>`;
  return { text, html };
}

const minutes = (ms: number) => Math.round(ms / 60_000);
const hours = (ms: number) => Math.round(ms / 3_600_000);

type Builder = (t: T) => { subject: string } & Layout;

async function send(to: Recipient | string, locale: string, build: Builder): Promise<void> {
  const { subject, ...layout } = build(makeT(toLocale(locale)));
  const message: MailMessage = { to: typeof to === "string" ? to : to.email, subject, ...render(layout) };
  await sendMail(message);
}

const IGNORE_NOTE = (t: T) => t("Si no has sido tú, ignora este mensaje: no se cambiará nada.");

export function sendPasswordResetMail(user: Recipient, url: string): Promise<void> {
  return send(user, user.locale, (t) => ({
    subject: t("Restablece tu contraseña de Pizarro"),
    paragraphs: [
      t("Hola, {name}:", { name: user.name }),
      t("Usa este enlace para elegir una contraseña nueva. Caduca en {n} minutos y solo sirve una vez.", { n: minutes(TOKEN_TTL_MS.PASSWORD_RESET) }),
    ],
    button: { label: t("Elegir contraseña nueva"), url },
    note: IGNORE_NOTE(t),
  }));
}

export function sendInviteMail(user: Recipient, url: string, invitedBy: string): Promise<void> {
  return send(user, user.locale, (t) => ({
    subject: t("Te han invitado a Pizarro"),
    paragraphs: [
      t("Hola, {name}:", { name: user.name }),
      t("{admin} te ha dado de alta en Pizarro. Usa este enlace para elegir tu contraseña. Caduca en {n} horas y solo sirve una vez.", { admin: invitedBy, n: hours(TOKEN_TTL_MS.INVITE) }),
    ],
    button: { label: t("Elegir mi contraseña"), url },
  }));
}

export function sendPasswordChangeMail(user: Recipient, url: string): Promise<void> {
  return send(user, user.locale, (t) => ({
    subject: t("Confirma el cambio de contraseña"),
    paragraphs: [
      t("Hola, {name}:", { name: user.name }),
      t("Has pedido cambiar tu contraseña de Pizarro. Confirma el cambio con este enlace; caduca en {n} minutos y solo sirve una vez.", { n: minutes(TOKEN_TTL_MS.PASSWORD_CHANGE) }),
    ],
    button: { label: t("Confirmar el cambio"), url },
    note: t("Si no has sido tú, ignora este mensaje: tu contraseña actual sigue igual. Te recomendamos cambiarla."),
  }));
}

export function sendPasswordChangedMail(user: Recipient): Promise<void> {
  return send(user, user.locale, (t) => ({
    subject: t("Tu contraseña de Pizarro ha cambiado"),
    paragraphs: [
      t("Hola, {name}:", { name: user.name }),
      t("La contraseña de tu cuenta se ha cambiado y se han cerrado tus sesiones abiertas."),
      t("Si no has sido tú, avisa a un administrador de inmediato."),
    ],
  }));
}

export function sendEmailChangeMail(user: Recipient, newEmail: string, url: string): Promise<void> {
  return send(newEmail, user.locale, (t) => ({
    subject: t("Confirma tu nuevo email en Pizarro"),
    paragraphs: [
      t("Hola, {name}:", { name: user.name }),
      t("Has pedido usar esta dirección como email de tu cuenta de Pizarro. Confírmalo con este enlace; caduca en {n} minutos y solo sirve una vez.", { n: minutes(TOKEN_TTL_MS.EMAIL_CHANGE) }),
    ],
    button: { label: t("Confirmar el email"), url },
    note: IGNORE_NOTE(t),
  }));
}

/** Aviso a la dirección antigua cuando se pide el cambio (aún no se ha hecho). */
export function sendEmailChangeRequestedMail(user: Recipient, newEmail: string): Promise<void> {
  return send(user, user.locale, (t) => ({
    subject: t("Se ha pedido cambiar el email de tu cuenta"),
    paragraphs: [
      t("Hola, {name}:", { name: user.name }),
      t("Se ha pedido cambiar el email de tu cuenta de Pizarro a {email}. El cambio solo se hará si se confirma desde esa dirección.", { email: newEmail }),
      t("Si no has sido tú, cambia tu contraseña y avisa a un administrador."),
    ],
  }));
}

/** Aviso a la dirección antigua cuando el cambio ya está hecho (por confirmación o por un administrador). */
export function sendEmailChangedMail(user: Recipient, oldEmail: string, newEmail: string): Promise<void> {
  return send(oldEmail, user.locale, (t) => ({
    subject: t("El email de tu cuenta de Pizarro ha cambiado"),
    paragraphs: [
      t("Hola, {name}:", { name: user.name }),
      t("El email de tu cuenta de Pizarro ya no es este: ahora es {email}.", { email: newEmail }),
      t("Si no has sido tú, avisa a un administrador de inmediato."),
    ],
  }));
}

export function sendNewLoginMail(user: Recipient, info: { when: Date; device: string; ip: string | null }): Promise<void> {
  return send(user, user.locale, (t) => ({
    subject: t("Nuevo inicio de sesión en Pizarro"),
    paragraphs: [
      t("Hola, {name}:", { name: user.name }),
      t("Se ha iniciado sesión en tu cuenta desde un dispositivo que no habíamos visto antes."),
    ],
    details: [
      [t("Fecha"), formatDate(info.when, "dateTime", intlLocale(toLocale(user.locale)))],
      [t("Dispositivo"), info.device],
      [t("IP"), info.ip ?? t("Desconocida")],
    ],
    note: t("Si has sido tú, no tienes que hacer nada. Si no, cambia tu contraseña desde «Mi perfil» y cierra las demás sesiones."),
  }));
}

/** Código de 6 dígitos para el segundo paso del acceso (o para dar de alta el método por email). */
export function sendTwoFactorCodeMail(user: Recipient, code: string): Promise<void> {
  return send(user, user.locale, (t) => ({
    subject: t("Tu código de verificación de Pizarro: {code}", { code }),
    paragraphs: [
      t("Hola, {name}:", { name: user.name }),
      t("Tu código de verificación es {code}. Caduca en {n} minutos y solo sirve una vez.", { code, n: minutes(EMAIL_CODE_TTL_MS) }),
    ],
    note: t("Si no has sido tú quien intenta entrar, cambia tu contraseña: alguien la conoce."),
  }));
}

/** Aviso de que la verificación en dos pasos de la cuenta ha cambiado. */
export function sendTwoFactorChangedMail(user: Recipient, change: "enabled" | "disabled" | "reset"): Promise<void> {
  return send(user, user.locale, (t) => ({
    subject: t("Cambios en la verificación en dos pasos de tu cuenta"),
    paragraphs: [
      t("Hola, {name}:", { name: user.name }),
      change === "enabled"
        ? t("Se ha activado o cambiado la verificación en dos pasos de tu cuenta de Pizarro.")
        : change === "disabled"
          ? t("Se ha desactivado la verificación en dos pasos de tu cuenta de Pizarro.")
          : t("Un administrador ha restablecido la verificación en dos pasos de tu cuenta de Pizarro."),
      t("Si no has sido tú, cambia tu contraseña y avisa a un administrador de inmediato."),
    ],
  }));
}

/** Aviso de que un administrador ha desvinculado la cuenta de Google del acceso. */
export function sendGoogleUnlinkedMail(user: Recipient): Promise<void> {
  return send(user, user.locale, (t) => ({
    subject: t("Se ha desvinculado tu cuenta de Google de Pizarro"),
    paragraphs: [
      t("Hola, {name}:", { name: user.name }),
      t("Un administrador ha desvinculado tu cuenta de Google del acceso a Pizarro y se han cerrado tus sesiones. Entra con tu contraseña; después podrás volver a entrar con Google."),
      t("Si no esperabas este cambio, avisa a un administrador."),
    ],
  }));
}

/** Aviso a los administradores: la última copia de seguridad correcta tiene más de 48 h (o no existe). */
export function sendBackupAlertMail(admin: Recipient, info: { lastAt: string | null }): Promise<void> {
  return send(admin, admin.locale, (t) => ({
    subject: t("Pizarro: la copia de seguridad está atrasada"),
    paragraphs: [
      t("Hola, {name}:", { name: admin.name }),
      info.lastAt
        ? t("La última copia de seguridad correcta es del {date}, hace más de 48 horas.", { date: formatDate(info.lastAt, "dateTime", intlLocale(toLocale(admin.locale))) })
        : t("Todavía no hay ninguna copia de seguridad correcta y la clave BACKUP_KEY está configurada."),
      t("Revisa los Logs de Administración y prueba «Crear copia ahora» en Administración → Copias de seguridad."),
    ],
    button: { label: t("Abrir Copias de seguridad"), url: `${appUrl()}/admin/backups` },
    note: t("Este aviso se repite como mucho una vez al día mientras el problema continúe."),
  }));
}
