// Plantillas de proyecto en la base de datos: lectura ordenada y plantillas de serie (sembrado, restablecer, recuperar).
import { createHash } from "node:crypto";
import type { PrismaClient } from "@/generated/prisma/client";
import { BUILTIN_TEMPLATES, builtinByKey, canonicalTemplate, comparable, isBuiltinModified, RETIRED_BUILTINS } from "./builtin-templates";
import { localizeTemplate } from "./builtin-templates-en";
import { hasExamples } from "./project-examples";
import { POSITION_STEP } from "./positions";
import { MAX_TEMPLATES } from "./project-templates-core";
import { parseStoredTemplate, sortTemplates, type TemplateData, type TemplateDto } from "./project-templates";

type Row = Parameters<typeof parseStoredTemplate>[0] & { builtinKey: string | null; updatedAt?: Date };
/** Lo que usan estas funciones: el cliente o una transacción (`tx`). */
type TemplateDb = Pick<PrismaClient, "projectTemplate" | "builtinTemplateSeeded">;

/** Fila de la base de datos → plantilla de la interfaz, marcando las de serie que ya no coinciden con la canónica. */
function toTemplateDto(row: Row): TemplateDto {
  const dto = { ...parseStoredTemplate(row), ...(row.updatedAt ? { version: row.updatedAt.toISOString() } : {}) };
  if (!row.builtinKey) return { ...dto, builtinKey: null };
  return { ...dto, builtinKey: row.builtinKey, builtinModified: isBuiltinModified(dto, row.builtinKey) };
}

/** Todas las plantillas, de serie y propias juntas, por orden alfabético. */
export async function listTemplatesSorted(db: PrismaClient, locale: "es" | "en" = "es"): Promise<TemplateDto[]> {
  const rows = await db.projectTemplate.findMany();
  // En inglés, las de serie sin tocar salen con su versión inglesa (el nombre decide el orden, así que se ordena después).
  return sortTemplates(rows.map((r) => localizeTemplate(toTemplateDto(r), r.builtinKey, locale)), locale);
}

/** Plantilla que se ofrece para empezar un proyecto («Nuevo proyecto») o para aplicarla a uno («Aplicar plantilla»). */
interface StartTemplate {
  id: string;
  name: string;
  description: string;
  /** De serie (con `builtinKey`), aunque el administrador la haya modificado. */
  builtin: boolean;
  /** Tiene tarjetas de ejemplo (casilla «Con tarjetas de ejemplo»). */
  examples: boolean;
}

/**
 * Plantillas con las que se puede empezar: los administradores, todas; los demás, solo las de serie que tenga la
 * instalación (las propias las gestionan los administradores). Por orden alfabético, en el idioma pedido.
 */
export async function listStartTemplates(db: PrismaClient, locale: "es" | "en", isAdmin: boolean): Promise<StartTemplate[]> {
  return (await listTemplatesSorted(db, locale))
    .filter((t) => isAdmin || t.builtinKey)
    .map((t) => ({ id: t.id, name: t.name, description: t.description, builtin: !!t.builtinKey, examples: hasExamples(t.builtinKey) }));
}

/** Claves de serie que no tienen plantilla ahora mismo (borradas por el administrador). */
export async function missingBuiltinKeys(db: TemplateDb): Promise<string[]> {
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
  taskFields: data.taskFields,
  releaseTemplates: data.releaseTemplates,
});

/** Anota la huella del contenido canónico aplicado a la plantilla de serie `key`. */
async function markApplied(db: TemplateDb, key: string, data: TemplateData): Promise<void> {
  const appliedHash = templateFingerprint(data);
  await db.builtinTemplateSeeded.upsert({ where: { key }, create: { key, appliedHash }, update: { appliedHash } });
}

async function createBuiltin(db: TemplateDb, key: string): Promise<void> {
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
 * Al arrancar, antes de sembrar: las plantillas de serie retiradas (`RETIRED_BUILTINS`) que siguen sin modificar se
 * borran; las modificadas por el administrador se quedan como plantillas propias (sin `builtinKey`), para no perder su
 * trabajo. «Sin modificar» = su contenido coincide con lo último que se le aplicó (`appliedHash`) o con su última
 * definición canónica. Los proyectos ya creados no cambian (son copias). Devuelve las claves borradas y las conservadas.
 *
 * Sus registros `BuiltinTemplateSeeded` se quedan como lápida: si se vuelve a la versión anterior, donde esas claves aún
 * son de serie, su siembra las da por sembradas y no las recrea (antes reaparecían las 12, y la modificada salía doble:
 * la propia y la de serie recién creada). Aquí no estorban: la siembra y «Recuperar» solo miran `BUILTIN_TEMPLATES`.
 * Con dos arranques a la vez, cada fila la retira solo uno (`deleteMany`/`updateMany` por id y clave, sin P2025).
 */
export async function retireBuiltinTemplates(db: PrismaClient): Promise<{ removed: string[]; kept: string[] }> {
  const keys = Object.keys(RETIRED_BUILTINS);
  const rows = await db.projectTemplate.findMany({ where: { builtinKey: { in: keys } }, orderBy: { position: "asc" } });
  const seeded = new Map((await db.builtinTemplateSeeded.findMany({ where: { key: { in: keys } } })).map((r) => [r.key, r.appliedHash]));
  const removed: string[] = [];
  const kept: string[] = [];
  for (const row of rows) {
    const key = row.builtinKey!;
    const stored = templateFingerprint(parseStoredTemplate(row));
    const mine = { id: row.id, builtinKey: key };
    if (stored === RETIRED_BUILTINS[key] || stored === seeded.get(key)) {
      if ((await db.projectTemplate.deleteMany({ where: mine })).count) removed.push(key);
    } else if ((await db.projectTemplate.updateMany({ where: mine, data: { builtinKey: null } })).count) {
      kept.push(key);
    }
  }
  return { removed, kept };
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

/**
 * «Recuperar plantillas de serie»: recrea las de serie que falten, sin pasar de `MAX_TEMPLATES` en total (antes se
 * saltaba el tope: con 49 propias se llegaba a 64). Debe ir en la transacción con el candado de las altas
 * (`lockTemplates`). Devuelve cuántas recuperó y cuántas se quedaron fuera por el tope.
 */
export async function restoreBuiltinTemplates(db: TemplateDb): Promise<{ restored: number; left: number }> {
  const missing = await missingBuiltinKeys(db);
  const room = Math.max(0, MAX_TEMPLATES - (await db.projectTemplate.count()));
  const restore = missing.slice(0, room);
  for (const key of restore) {
    await createBuiltin(db, key);
    const canon = canonicalTemplate(key);
    if (canon) await markApplied(db, key, canon);
  }
  return { restored: restore.length, left: missing.length - restore.length };
}

/** Candado común de las altas de plantillas (crear y recuperar): dos a la vez no pasan del máximo. */
export async function lockTemplates(tx: Pick<PrismaClient, "$executeRaw">): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('pz:project-templates'))::text`;
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
