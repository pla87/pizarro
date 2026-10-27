/** Pestañas de «Mi perfil»: la elegida va en `?tab=`; sin valor (o con uno desconocido) se abre «Cuenta». */
export const PROFILE_TABS = [
  { id: "cuenta", label: "Cuenta" },
  { id: "preferencias", label: "Preferencias" },
  { id: "avisos", label: "Avisos" },
] as const;

export type ProfileTab = (typeof PROFILE_TABS)[number]["id"];

export function parseProfileTab(value: unknown): ProfileTab {
  return PROFILE_TABS.find((t) => t.id === value)?.id ?? "cuenta";
}
