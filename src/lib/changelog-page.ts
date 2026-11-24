// Versiones del Historial de versiones, leídas de AppVersionLog en el idioma de quien las ve.
import "server-only";
import { db } from "./db";
import { parseChanges } from "./changelog";
import { compareVersionsDesc, type ChangelogVersion } from "./changelog-core";

/**
 * Las versiones desde la posición `from` (0 = la más reciente), como mucho `limit`, y el total. Primero se ordenan solo
 * los números (la tabla no ordena SemVer) y después se leen los textos de las que se devuelven. «Cambios técnicos / DB»
 * (jerga de quien instala o programa) solo llega a quien administra: al resto se le manda vacío desde aquí, no se oculta
 * en el navegador.
 */
export async function changelogVersions(
  { en, admin }: { en: boolean; admin: boolean },
  from: number,
  limit = Infinity,
): Promise<{ versions: ChangelogVersion[]; total: number }> {
  const all = (await db.appVersionLog.findMany({ select: { id: true, version: true } })).sort((a, b) => compareVersionsDesc(a.version, b.version));
  const ids = all.slice(from, from + limit).map((v) => v.id);
  const rows = ids.length
    ? await db.appVersionLog.findMany({
        where: { id: { in: ids } },
        // Solo lo que se muestra (sin syncedAt), y la traducción solo en inglés.
        select: { id: true, version: true, releasedAt: true, summary: true, changes: true, summaryEn: en, changesEn: en },
      })
    : [];
  const byId = new Map(rows.map((v) => [v.id, v]));
  const versions = ids.flatMap((id): ChangelogVersion[] => {
    const v = byId.get(id);
    if (!v) return [];
    const changes = en && v.changesEn ? parseChanges(v.changesEn) : parseChanges(v.changes);
    return [{
      id: v.id,
      version: v.version,
      releasedAt: v.releasedAt.toISOString(),
      // En inglés, la traducción si la hay; si no, el texto original.
      summary: en && v.summaryEn ? v.summaryEn : v.summary,
      changes: admin ? changes : { ...changes, tecnicos: [] },
    }];
  });
  return { versions, total: all.length };
}
