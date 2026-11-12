import type { T } from "../i18n/shared";

// Qué le pasa a la plantilla de verificación de WhatsApp (codigo_pizarro) cuando Meta la rechaza, y cómo se explica.
// Sin dependencias: lo usan el servidor (al enviar un código) y las pantallas de Ajustes y Mi perfil.
// Códigos de error de Meta: https://developers.facebook.com/documentation/business-messaging/whatsapp/support/error-codes

export type CodeTemplateProblem = "missing" | "params" | "paused";

/**
 * «missing»: no existe en ese idioma o no está aprobada (132001). «params»: no tiene la forma esperada (132000, 132012,
 * 132018), p. ej. una plantilla de utilidad con ese nombre en vez de una de autenticación con «Copiar código».
 * «paused»: pausada o desactivada por mala calidad (132015, 132016).
 */
export function codeTemplateProblem(code: number | null | undefined): CodeTemplateProblem | null {
  if (code === 132001) return "missing";
  if (code === 132000 || code === 132012 || code === 132018) return "params";
  if (code === 132015 || code === 132016) return "paused";
  return null;
}

/** Explicación para el administrador (Ajustes y su «Probar»): qué falla y qué hacer en Meta. */
export function codeTemplateAdminText(t: T, problem: CodeTemplateProblem, info: { name: string; lang: string; code: number }): string {
  switch (problem) {
    case "missing":
      return t("La plantilla de verificación «{name}» ({lang}) no existe en Meta o aún no está aprobada (error {code}). Créala en WhatsApp Manager: categoría Autenticación, opción «Copiar código», con ese nombre e idioma. Hasta entonces nadie puede conectar su WhatsApp.", info);
    case "params":
      return t("La plantilla de verificación «{name}» no tiene la forma que espera Pizarro (error {code}): tiene que ser de categoría Autenticación con el botón «Copiar código».", info);
    case "paused":
      return t("Meta ha pausado o desactivado la plantilla de verificación «{name}» (error {code}). Revísala en WhatsApp Manager.", info);
  }
}

/** Explicación para quien intenta conectar su WhatsApp en Mi perfil (no puede arreglarlo: avisa al administrador). */
export function codeTemplateUserText(t: T): string {
  return t("Ahora no se pueden enviar códigos por WhatsApp: el administrador de Pizarro tiene que crear (o revisar) en Meta la plantilla de verificación. Avísale y vuelve a intentarlo después.");
}
