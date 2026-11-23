import { resolveTabParam, type TabResolution } from "@/lib/tab-param";

/**
 * Pestañas de «Ajustes del proyecto»: la elegida va en `?tab=`; sin valor se abre la primera disponible. También valen
 * otros nombres esperables (alias: «plantillas», en inglés…); con uno desconocido, o de una pestaña que esta persona no
 * tiene, se abre la primera y la página lo avisa.
 */
export const PROJECT_SETTINGS_TABS = [
  { id: "general", label: "General", manageOnly: true, aliases: ["ajustes", "settings", "proyecto", "project"] },
  { id: "tablero", label: "Tablero", manageOnly: false, aliases: ["board", "columnas", "columns", "etiquetas", "labels", "tipos", "kinds", "entregables", "deliverables"] },
  { id: "adjuntos", label: "Adjuntos y límites", manageOnly: true, aliases: ["attachments", "limites", "limits", "almacenamiento", "storage"] },
  // Plantillas de release notes y del plan de trabajo para IA (el id sigue siendo «releases»: enlaces guardados).
  { id: "releases", label: "Plantillas", manageOnly: false, aliases: ["plantillas", "templates", "plan"] },
  { id: "informes", label: "Informes", manageOnly: false, aliases: ["informe", "reports", "report"] },
] as const;

export type ProjectSettingsTab = (typeof PROJECT_SETTINGS_TABS)[number]["id"];

/** Pestañas que ve cada persona: quien no puede gestionar el proyecto solo tiene las que no son de gestión. */
export function availableProjectTabs(canManage: boolean) {
  return PROJECT_SETTINGS_TABS.filter((t) => canManage || !t.manageOnly);
}

export function resolveProjectSettingsTab(value: unknown, canManage: boolean): TabResolution<ProjectSettingsTab> {
  return resolveTabParam<ProjectSettingsTab>(value, availableProjectTabs(canManage));
}

/** Secciones con ancla (`#labels`…) y la pestaña donde viven, para que los enlaces antiguos abran la correcta. */
export const SECTION_TAB: Record<string, ProjectSettingsTab> = {
  labels: "tablero",
  deliverables: "tablero",
  kinds: "tablero",
  members: "general",
};
