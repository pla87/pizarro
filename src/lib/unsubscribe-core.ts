import { timingSafeEqual } from "node:crypto";
import { labelledHmac, labelledHmacCandidates } from "./keyring";
import type { NotificationKind } from "./notification-text";

// Parte pura (sin base de datos) de la baja en un clic de los emails de avisos, el resumen diario y el informe semanal
// (RFC 8058): qué casilla apaga cada email, el token firmado del enlace y las cabeceras List-Unsubscribe.
//
// El token no se guarda en ningún sitio: es «<tipo><id>.<firma>», con la firma HMAC (TOKEN_SECRET, etiqueta propia
// «unsubscribe»: no vale para nada más) de tipo, id y email de destino. Solo sirve para apagar ESE tipo de email: el
// tipo va firmado, así que cambiar la letra lo invalida. Al cambiar el email de la cuenta o el destinatario del informe,
// los enlaces de los emails anteriores dejan de valer. No caduca: un email de hace meses debe poder darse de baja igual.

/**
 * Tipos de email que se pueden dar de baja: los cuatro grupos de avisos sobre proyectos de Mi perfil, los emails de
 * administración (v1.79), el resumen y el informe semanal. «note» (menciones en notas, v1.77) ya no tiene opción propia:
 * los emails enviados con su enlace siguen valiendo y apagan «Menciones en tareas y notas».
 */
export type UnsubscribeKind = "mention" | "assigned" | "due" | "comment" | "admin" | "note" | "digest" | "report";

const CODES: Record<UnsubscribeKind, string> = { mention: "m", assigned: "a", due: "d", comment: "c", admin: "x", note: "n", digest: "g", report: "r" };
const KIND_BY_CODE = new Map(Object.entries(CODES).map(([k, c]) => [c, k as UnsubscribeKind]));

/** Casilla de Mi perfil (columna de User) de cada tipo de email de una persona. */
export const EMAIL_PREF_FIELD = {
  mention: "notifyEmail",
  assigned: "notifyAssignedEmail",
  due: "notifyDueEmail",
  comment: "notifyCommentEmail",
  admin: "notifyAdminEmail",
  /** Enlaces de la v1.77 (menciones en notas): la casilla de las menciones. */
  note: "notifyEmail",
} as const satisfies Record<Exclude<UnsubscribeKind, "report" | "digest">, string>;

/** Casillas de «Emails sobre proyectos»: lo que trae el resumen diario y lo que apaga su baja. */
export const PROJECT_EMAIL_FIELDS = ["notifyEmail", "notifyAssignedEmail", "notifyDueEmail", "notifyCommentEmail"] as const;

/**
 * Grupo de un aviso para el email (la casilla que lo decide y la que apaga su enlace de baja). Los recordatorios de
 * «Esperando» van con las fechas límite (como en Telegram y WhatsApp); los avisos de administración (v1.79: proyecto
 * que pasa a ser de equipo, baja de un informe, enlace revocado) tienen su casilla, y salen siempre al momento.
 */
export function noticeEmailKind(type: NotificationKind): "mention" | "assigned" | "due" | "comment" | "admin" {
  switch (type) {
    case "ASSIGNED": return "assigned";
    case "DUE_CHANGED":
    case "WAITING": return "due";
    case "COMMENT":
    case "REPLY": return "comment";
    case "PROJECT_TO_TEAM":
    case "REPORT_UNSUBSCRIBED":
    case "SHARE_REVOKED": return "admin";
    default: return "mention";
  }
}

const SIG_LEN = 32;
const TOKEN_RE = /^([madcxngr])([A-Za-z0-9_-]{1,40})\.([0-9a-f]{32})$/;

const signed = (kind: UnsubscribeKind, id: string, email: string) => `${kind}:${id}:${email.trim().toLowerCase()}`;

/** Token del enlace de baja: `id` es la persona (o, en el informe, el proyecto) y `email`, la dirección de destino. */
export function unsubscribeToken(kind: UnsubscribeKind, id: string, email: string): string {
  return `${CODES[kind]}${id}.${labelledHmac("unsubscribe", signed(kind, id, email)).slice(0, SIG_LEN)}`;
}

/** Tipo e id de un token con forma válida (sin comprobar la firma: hace falta el email, que está en la BD), o null. */
export function parseUnsubscribeToken(token: string): { kind: UnsubscribeKind; id: string; sig: string } | null {
  const m = TOKEN_RE.exec(token);
  const kind = m ? KIND_BY_CODE.get(m[1]!) : undefined;
  return m && kind ? { kind, id: m[2]!, sig: m[3]! } : null;
}

/** ¿Es la firma de este tipo, id y email? Con la clave actual o, durante la rotación, con TOKEN_SECRET_PREVIOUS. */
export function unsubscribeSignatureOk(t: { kind: UnsubscribeKind; id: string; sig: string }, email: string): boolean {
  const got = Buffer.from(t.sig);
  return labelledHmacCandidates("unsubscribe", signed(t.kind, t.id, email)).some((h) => {
    const want = Buffer.from(h.slice(0, SIG_LEN));
    return want.length === got.length && timingSafeEqual(want, got);
  });
}

/**
 * Cabeceras de la baja en un clic (RFC 8058): solo con una dirección https (los gestores de correo no hacen el POST a
 * otra cosa, y el RFC lo exige). Sin https queda el enlace del pie, que lleva a la página de confirmación.
 */
export function unsubscribeHeaders(oneClickUrl: string): Record<string, string> {
  if (!/^https:\/\//i.test(oneClickUrl)) return {};
  return { "List-Unsubscribe": `<${oneClickUrl}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" };
}
