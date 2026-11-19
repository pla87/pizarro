import { readFile } from "node:fs/promises";
import path from "node:path";
import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import { changelogSchema } from "./changelog";

/** JSON con las claves ordenadas: jsonb no conserva el orden de las claves, así que se compara así. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonical((value as Record<string, unknown>)[k])}`).join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

/**
 * Inserta o actualiza en AppVersionLog cada versión de changelog.json. Devuelve cuántas hay. Lee antes las que ya están
 * y solo escribe las que faltan o han cambiado (en cada arranque, casi todas siguen igual).
 */
export async function syncChangelog(db: PrismaClient, file = path.resolve("changelog.json")): Promise<number> {
  const { versions } = changelogSchema.parse(JSON.parse(await readFile(file, "utf8")));
  const existing = new Map(
    (await db.appVersionLog.findMany({ select: { version: true, releasedAt: true, summary: true, changes: true, summaryEn: true, changesEn: true } })).map((r) => [r.version, r]),
  );
  for (const v of versions) {
    const data = {
      releasedAt: new Date(v.releasedAt ?? `${v.date}T00:00:00Z`),
      summary: v.summary,
      changes: v.changes,
      summaryEn: v.en?.summary ?? "",
      changesEn: v.en?.changes ?? Prisma.DbNull,
    };
    const row = existing.get(v.version);
    if (
      row &&
      row.releasedAt.getTime() === data.releasedAt.getTime() &&
      row.summary === data.summary &&
      canonical(row.changes) === canonical(data.changes) &&
      row.summaryEn === data.summaryEn &&
      canonical(row.changesEn) === canonical(v.en?.changes ?? null)
    ) {
      continue;
    }
    await db.appVersionLog.upsert({ where: { version: v.version }, create: { version: v.version, ...data }, update: data });
  }
  return versions.length;
}
