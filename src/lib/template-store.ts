// Plantillas de proyecto en la base de datos: lectura ordenada y plantillas de serie (sembrado, restablecer, recuperar).
import { createHash } from "node:crypto";
import type { PrismaClient } from "@/generated/prisma/client";
import { BUILTIN_TEMPLATES, builtinByKey, canonicalTemplate, comparable, isBuiltinModified } from "./builtin-templates";
import { localizeTemplate } from "./builtin-templates-en";
import { POSITION_STEP } from "./positions";
import { parseStoredTemplate, sortTemplates, type TemplateData, type TemplateDto } from "./project-templates";

type Row = Parameters<typeof parseStoredTemplate>[0] & { builtinKey: string | null };

/** Fila de la base de datos → plantilla de la interfaz, marcando las de serie que ya no coinciden con la canónica. */
export function toTemplateDto(row: Row): TemplateDto {
  const dto = parseStoredTemplate(row);
  if (!row.builtinKey) return { ...dto, builtinKey: null };
  return { ...dto, builtinKey: row.builtinKey, builtinModified: isBuiltinModified(dto, row.builtinKey) };
}

/** Todas las plantillas, de serie y propias juntas, por orden alfabético. */
export async function listTemplatesSorted(db: PrismaClient, locale: "es" | "en" = "es"): Promise<TemplateDto[]> {
  const rows = await db.projectTemplate.findMany();
  // En inglés, las de serie sin tocar salen con su versión inglesa (el nombre decide el orden, así que se ordena después).
  return sortTemplates(rows.map((r) => localizeTemplate(toTemplateDto(r), r.builtinKey, locale)), locale);
}

/** Claves de serie que no tienen plantilla ahora mismo (borradas por el administrador). */
export async function missingBuiltinKeys(db: PrismaClient): Promise<string[]> {
  const present = new Set((await db.projectTemplate.findMany({ where: { builtinKey: { not: null } }, select: { builtinKey: true } })).map((r) => r.builtinKey));
  return BUILTIN_TEMPLATES.map((b) => b.key).filter((k) => !present.has(k));
}

/** Huella del contenido de una plantilla (la misma forma comparable que usa «modificada»). */
export function templateFingerprint(t: TemplateData): string {
  return createHash("sha256").update(comparable(t)).digest("hex");
}

/**
 * Definición anterior a que existiera la huella guardada: la canónica actual sin la opción «ocultar todos los
 * generales» (lo único que cambió en esa versión). Sirve de referencia para las sembradas antes de la huella.
 */
function legacyBaseline(canon: TemplateData): TemplateData {
  return { ...canon, hideAllGeneralKinds: false };
}

const contentOf = (data: TemplateData) => ({
  name: data.name,
  description: data.description,
  columns: data.columns,
  kinds: data.kinds,
  hiddenGeneralKinds: data.hiddenGeneralKinds,
  hideAllGeneralKinds: data.hideAllGeneralKinds,
  labels: data.labels,
  releaseTemplates: data.releaseTemplates,
});

/** Anota la huella del contenido canónico aplicado a la plantilla de serie `key`. */
async function markApplied(db: PrismaClient, key: string, data: TemplateData): Promise<void> {
  const appliedHash = templateFingerprint(data);
  await db.builtinTemplateSeeded.upsert({ where: { key }, create: { key, appliedHash }, update: { appliedHash } });
}

async function createBuiltin(db: PrismaClient, key: string): Promise<void> {
  const data = canonicalTemplate(key);
  if (!data) return;
  const last = await db.projectTemplate.findFirst({ orderBy: { position: "desc" }, select: { position: true } });
  await db.projectTemplate.create({
    data: {
      builtinKey: key,
      ...contentOf(data),
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
    const canon = canonicalTemplate(key);
    if (canon) await markApplied(db, key, canon);
  }
  return created;
}

/**
 * Pone al día las plantillas de serie cuando cambia su definición canónica. Se guarda la huella del contenido
 * canónico aplicado la última vez (`appliedHash`): si lo almacenado sigue siendo exactamente eso, el administrador no la
 * tocó y se sustituye por la nueva; si difiere, se respeta (figurará como modificada, con «Restablecer»).
 * Sin huella (sembradas antes de existir) la referencia es la definición anterior, ver `legacyBaseline`.
 * Devuelve las claves actualizadas.
 */
export async function upgradeBuiltinTemplates(db: PrismaClient): Promise<string[]> {
  const upgraded: string[] = [];
  for (const { key } of BUILTIN_TEMPLATES) {
    const canon = canonicalTemplate(key);
    const seeded = await db.builtinTemplateSeeded.findUnique({ where: { key } });
    const row = await db.projectTemplate.findUnique({ where: { builtinKey: key } });
    if (!canon || !seeded || !row) continue;
    const canonHash = templateFingerprint(canon);
    const storedHash = templateFingerprint(parseStoredTemplate(row));
    const appliedHash = seeded.appliedHash ?? templateFingerprint(legacyBaseline(canon));
    if (storedHash === canonHash) {
      if (seeded.appliedHash !== canonHash) await markApplied(db, key, canon);
    } else if (storedHash === appliedHash) {
      await db.projectTemplate.update({ where: { id: row.id }, data: contentOf(canon) });
      await markApplied(db, key, canon);
      upgraded.push(key);
    } else if (seeded.appliedHash === null) {
      // Modificada por el administrador: se fija su referencia para que un cambio canónico futuro no la confunda.
      await db.builtinTemplateSeeded.update({ where: { key }, data: { appliedHash } });
    }
  }
  return upgraded;
}

/** «Recuperar plantillas por defecto»: recrea las de serie que falten. Devuelve cuántas. */
export async function restoreBuiltinTemplates(db: PrismaClient): Promise<number> {
  const missing = await missingBuiltinKeys(db);
  for (const key of missing) {
    await createBuiltin(db, key);
    const canon = canonicalTemplate(key);
    if (canon) await markApplied(db, key, canon);
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
    data: contentOf(data),
  });
  await markApplied(db, row!.builtinKey!, data);
  return true;
}
