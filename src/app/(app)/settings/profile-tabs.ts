import { resolveTabParam, type TabResolution } from "@/lib/tab-param";

/**
 * Pestañas de «Mi perfil»: la elegida va en `?tab=`; sin valor se abre «Cuenta». También valen otros nombres esperables
 * (alias, en inglés incluidos); con uno desconocido se abre «Cuenta» y la página lo avisa.
 */
export const PROFILE_TABS = [
  { id: "cuenta", label: "Cuenta", aliases: ["account", "perfil", "profile", "seguridad", "security"] },
  { id: "preferencias", label: "Preferencias", aliases: ["preferences", "apariencia", "appearance"] },
  { id: "plantillas", label: "Plantillas", aliases: ["templates"] },
  { id: "avisos", label: "Avisos", aliases: ["notificaciones", "notifications", "mensajeria", "messaging"] },
] as const;

export type ProfileTab = (typeof PROFILE_TABS)[number]["id"];

export function resolveProfileTab(value: unknown): TabResolution<ProfileTab> {
  return resolveTabParam<ProfileTab>(value, PROFILE_TABS);
}
