import "server-only";
import { db } from "./db";
import type { TemplateOption } from "./types";

// Cabeceras y pies del plan de trabajo para IA: las mismas tablas que las de release (ReleaseTemplate de cada persona y
// ProjectReleaseTemplate del proyecto) con los tipos PLAN_HEADER y PLAN_FOOTER.

const select = { id: true, kind: true, name: true, content: true } as const;
const orderBy = [{ position: "asc" as const }, { createdAt: "asc" as const }];

function split(rows: { id: string; kind: string; name: string; content: string }[]): { headers: TemplateOption[]; footers: TemplateOption[] } {
  const pick = (kind: string) => rows.filter((r) => r.kind === kind).map(({ id, name, content }) => ({ id, name, content }));
  return { headers: pick("PLAN_HEADER"), footers: pick("PLAN_FOOTER") };
}

/** Las de la persona (Mi perfil → Plantillas), en su orden: la primera es la que el plan elige por defecto. */
export async function userPlanTemplates(userId: string) {
  return split(await db.releaseTemplate.findMany({ where: { userId, kind: { in: ["PLAN_HEADER", "PLAN_FOOTER"] } }, orderBy, select }));
}

/** Las del proyecto (Ajustes del proyecto → Plantillas), en su orden. */
export async function projectPlanTemplates(projectId: string) {
  return split(await db.projectReleaseTemplate.findMany({ where: { projectId, kind: { in: ["PLAN_HEADER", "PLAN_FOOTER"] } }, orderBy, select }));
}
