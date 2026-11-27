// Pasar a privado un proyecto de equipo (Ajustes del proyecto → Visibilidad): quién conserva el acceso. Lo decide
// setProjectVisibility (src/actions/projects.ts): sus miembros actuales (desde la v1.74.0 quien crea un proyecto es uno de
// ellos) y quien lo cambia. Puro: lo usa el diálogo de confirmación del navegador.
import type { T } from "@/i18n/shared";

/** Como mucho, cuántos nombres dice la confirmación (luego, «y N más»). */
const KEEP_NAMES = 8;

/**
 * Quiénes mantienen el acceso al pasar a privado, para la confirmación: «tú» (quien lo cambia, que entra si no era
 * miembro) y los demás miembros en su orden; con muchos, los primeros y «N más».
 */
export function privateKeepNames(members: readonly { id: string; name: string }[], currentUserId: string, t: T, locale: string): string {
  const others = members.filter((m) => m.id !== currentUserId).map((m) => m.name);
  const names = [t("tú"), ...others];
  const shown = names.length > KEEP_NAMES ? [...names.slice(0, KEEP_NAMES - 1), t("{n} más", { n: names.length - KEEP_NAMES + 1 })] : names;
  return new Intl.ListFormat(locale, { type: "conjunction" }).format(shown);
}
