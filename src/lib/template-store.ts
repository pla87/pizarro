// Plantillas de proyecto en la base de datos: lectura ordenada y plantillas de serie (sembrado, restablecer, recuperar).
import type { PrismaClient } from "@/generated/prisma/client";
import { BUILTIN_TEMPLATES, builtinByKey, canonicalTemplate, isBuiltinModified } from "./builtin-templates";
import { POSITION_STEP } from "./positions";
import { parseStoredTemplate, sortTemplates, type TemplateDto } from "./project-templates";

type Row = Parameters<typeof parseStoredTemplate>[0] & { builtinKey: string | null };

/** Fila de la base de datos → plantilla de la interfaz, marcando las de serie que ya no coinciden con la canónica. */
export function toTemplateDto(row: Row): TemplateDto {
  const dto = parseStoredTemplate(row);
  if (!row.builtinKey) return { ...dto, builtinKey: null };
  return { ...dto, builtinKey: row.builtinKey, builtinModified: isBuiltinModified(dto, row.builtinKey) };
}

/** Todas las plantillas, de serie y propias juntas, por orden alfabético. */
export async function listTemplatesSorted(db: PrismaClient): Promise<TemplateDto[]> {
  const rows = await db.projectTemplate.findMany();
  return sortTemplates(rows.map(toTemplateDto));
}

/** Claves de serie que no tienen plantilla ahora mismo (borradas por el administrador). */
export async function missingBuiltinKeys(db: PrismaClient): Promise<string[]> {
  const present = new Set((await db.projectTemplate.findMany({ where: { builtinKey: { not: null } }, select: { builtinKey: true } })).map((r) => r.builtinKey));
  return BUILTIN_TEMPLATES.map((b) => b.key).filter((k) => !present.has(k));
}

async function createBuiltin(db: PrismaClient, key: string): Promise<void> {
  const data = canonicalTemplate(key);
  if (!data) return;
  const last = await db.projectTemplate.findFirst({ orderBy: { position: "desc" }, select: { position: true } });
  await db.projectTemplate.create({
    data: {
      builtinKey: key,
      name: data.name,
      description: data.description,
      columns: data.columns,
      kinds: data.kinds,
      hiddenGeneralKinds: data.hiddenGeneralKinds,
      labels: data.labels,
      position: (last?.position ?? 0) + POSITION_STEP,
    },
  });
}

/**
 * Al arrancar: crea las plantillas de serie que nunca se habían sembrado. El registro `BuiltinTemplateSeeded` se
 * conserva aunque el administrador borre la plantilla, así que una borrada no vuelve sola (solo con «Recuperar»).
 */
export async function seedBuiltinTemplates(db: PrismaClient): Promise<string[]> {
  const seeded = new Set((await db.builtinTemplateSeeded.findMany({ select: { key: true } })).map((r) => r.key));
  const present = new Set((await db.projectTemplate.findMany({ where: { builtinKey: { not: null } }, select: { builtinKey: true } })).map((r) => r.builtinKey));
  const created: string[] = [];
  for (const { key } of BUILTIN_TEMPLATES) {
    if (seeded.has(key)) continue;
    if (!present.has(key)) {
      await createBuiltin(db, key);
      created.push(key);
    }
    await db.builtinTemplateSeeded.upsert({ where: { key }, create: { key }, update: {} });
  }
  return created;
}

/** «Recuperar plantillas por defecto»: recrea las de serie que falten. Devuelve cuántas. */
export async function restoreBuiltinTemplates(db: PrismaClient): Promise<number> {
  const missing = await missingBuiltinKeys(db);
  for (const key of missing) {
    await createBuiltin(db, key);
    await db.builtinTemplateSeeded.upsert({ where: { key }, create: { key }, update: {} });
  }
  return missing.length;
}

/** «Restablecer»: deja la plantilla con el contenido canónico. Falso si no es de serie. */
export async function resetBuiltinTemplate(db: PrismaClient, templateId: string): Promise<boolean> {
  const row = await db.projectTemplate.findUnique({ where: { id: templateId }, select: { builtinKey: true } });
  const data = row?.builtinKey && builtinByKey(row.builtinKey) ? canonicalTemplate(row.builtinKey) : null;
  if (!data) return false;
  await db.projectTemplate.update({
    where: { id: templateId },
    data: { name: data.name, description: data.description, columns: data.columns, kinds: data.kinds, hiddenGeneralKinds: data.hiddenGeneralKinds, labels: data.labels },
  });
  return true;
}
