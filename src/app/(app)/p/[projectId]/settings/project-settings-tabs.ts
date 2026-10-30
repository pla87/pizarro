/** Pestañas de «Ajustes del proyecto»: la elegida va en `?tab=`; sin valor (o desconocido) se abre la primera disponible. */
export const PROJECT_SETTINGS_TABS = [
  { id: "general", label: "General", manageOnly: true },
  { id: "tablero", label: "Tablero", manageOnly: false },
  { id: "adjuntos", label: "Adjuntos y límites", manageOnly: true },
  { id: "releases", label: "Releases", manageOnly: false },
  { id: "informes", label: "Informes", manageOnly: false },
] as const;

export type ProjectSettingsTab = (typeof PROJECT_SETTINGS_TABS)[number]["id"];

/** Pestañas que ve cada persona: quien no puede gestionar el proyecto solo tiene las que no son de gestión. */
export function availableProjectTabs(canManage: boolean) {
  return PROJECT_SETTINGS_TABS.filter((t) => canManage || !t.manageOnly);
}

export function parseProjectSettingsTab(value: unknown, canManage: boolean): ProjectSettingsTab {
  const tabs = availableProjectTabs(canManage);
  return tabs.find((t) => t.id === value)?.id ?? tabs[0]!.id;
}

/** Secciones con ancla (`#labels`…) y la pestaña donde viven, para que los enlaces antiguos abran la correcta. */
export const SECTION_TAB: Record<string, ProjectSettingsTab> = {
  labels: "tablero",
  deliverables: "tablero",
  kinds: "tablero",
};
