import "server-only";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { describeAction } from "./action-context";
import { APP_SHORT_NAME_KEY, getAppIcon, getAppShortName, setAppIcon, setAppShortName } from "./app-icon";
import { APP_ICON_ACCENTS, cleanAppShortName } from "./app-icon-core";
import { appStateVersion, assertVersion } from "./edit-conflict";
import { AppError } from "./errors";
import { requireAdmin } from "./session";

/**
 * Guarda el color del icono de la app (Administración → Ajustes → «Icono de la app»). Lo usan la acción `saveAppIcon`
 * y la ruta /api/admin/app-icon (el guardado con sendBeacon al cerrar la pestaña), las dos dentro de
 * runAction({ name: "settings.saveAppIcon" }). La ruta no importa la acción: si un módulo "use server" entra en una ruta,
 * Next puede reenviar a esa ruta las llamadas a la acción hechas desde una página que no la incluye, y no se ejecutan.
 */
export async function changeAppIcon(accent: string) {
  await requireAdmin();
  const next = z.enum(APP_ICON_ACCENTS, { error: "Color no válido." }).parse(accent);
  const prev = await getAppIcon();
  await setAppIcon(next);
  describeAction("Cambió el color del icono de la app de {from} a {to}", { from: prev, to: next });
  // El favicon y el apple-touch-icon van en el <head> de todas las páginas.
  revalidatePath("/", "layout");
  return { accent: next };
}

/**
 * Guarda la etiqueta propia bajo el icono de la app (vacía = el nombre de la organización, recortado si no cabe). `since`:
 * la versión que se abrió (si otro administrador la cambió después, no se pisa).
 */
export async function changeAppShortName(label: string, since?: string) {
  await requireAdmin();
  if (typeof label !== "string" || label.length > 200) throw new AppError("Datos no válidos.");
  assertVersion(since, await appStateVersion([APP_SHORT_NAME_KEY]));
  const prev = await getAppShortName();
  const next = cleanAppShortName(label);
  await setAppShortName(next);
  describeAction("Cambió el nombre bajo el icono de la app de «{from}» a «{to}»", { from: prev || "automático", to: next || "automático" });
  // Lo leen el manifiesto y el <head> de todas las páginas (apple-mobile-web-app-title).
  revalidatePath("/", "layout");
  return { shortName: next, version: await appStateVersion([APP_SHORT_NAME_KEY]) };
}
