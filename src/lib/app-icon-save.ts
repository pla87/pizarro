import "server-only";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { describeAction } from "./action-context";
import { getAppIcon, setAppIcon } from "./app-icon";
import { APP_ICON_ACCENTS } from "./app-icon-core";
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
