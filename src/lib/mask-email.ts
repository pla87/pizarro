// Enmascarado de emails para los logs (funciones puras, sin BD): solo afecta a lo que se registra, nunca a lo que se envía.

/** «ana@example.com» → «a***@example.com». Sin «@» o con la parte local vacía no se puede mostrar nada del usuario. */
export function maskEmail(email: string | null | undefined): string {
  const value = (email ?? "").trim();
  if (!value) return "";
  const at = value.lastIndexOf("@");
  if (at < 0) return "***";
  const local = value.slice(0, at);
  const domain = value.slice(at + 1);
  const first = [...local][0] ?? "";
  return `${first}***@${domain}`;
}

/** Enmascara cualquier dirección que aparezca dentro de un texto (p. ej. el mensaje de error de un servidor SMTP). */
export function maskEmailsIn(text: string): string {
  return text.replace(/[^\s<>"',;()]+@[^\s<>"',;()]+/g, (m) => maskEmail(m));
}

/**
 * Registra en la consola el fallo de un envío de email sin las direcciones: el error de nodemailer lleva la respuesta
 * del servidor SMTP («550 <ana@example.com>: user unknown») y, al volcarlo tal cual, las direcciones acababan en los logs.
 */
export function logMailError(label: string, err: unknown): void {
  const e = (typeof err === "object" && err ? err : {}) as { response?: unknown; code?: unknown };
  let text = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  if (typeof e.response === "string" && !text.includes(e.response)) text += ` — ${e.response}`;
  if (typeof e.code === "string") text += ` (${e.code})`;
  console.error(label, maskEmailsIn(text));
}
