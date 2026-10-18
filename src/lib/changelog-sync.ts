import { readFile } from "node:fs/promises";
import path from "node:path";
import type { PrismaClient } from "@/generated/prisma/client";
import { changelogSchema } from "./changelog";

/** Inserta o actualiza en AppVersionLog cada versión de changelog.json. Devuelve cuántas hay. */
export async function syncChangelog(db: PrismaClient, file = path.resolve("changelog.json")): Promise<number> {
  const { versions } = changelogSchema.parse(JSON.parse(await readFile(file, "utf8")));
  for (const v of versions) {
    const data = { releasedAt: new Date(`${v.date}T00:00:00Z`), summary: v.summary, changes: v.changes };
    await db.appVersionLog.upsert({ where: { version: v.version }, create: { version: v.version, ...data }, update: data });
  }
  return versions.length;
}
