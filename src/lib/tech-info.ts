import "server-only";
import pkg from "../../package.json";
import { formatTechInfo, type InstallKind } from "./bug-report-core";
import { db } from "./db";
import { buildId, migrationFolder } from "./doctor";
import { configFlags, envPresence, migrationStatus } from "./doctor-core";

/** Texto de «Copiar información técnica»: versión, commit, Node, base de datos y nombres de variables (sin valores). */
export async function collectTechInfo(): Promise<string> {
  const presence = envPresence();
  const flags = configFlags();
  const [postgres, migrations] = await Promise.all([
    db.$queryRaw<{ version: string }[]>`SELECT current_setting('server_version') AS version`.then((r) => r[0]?.version ?? null, () => null),
    db.$queryRaw<{ migration_name: string; finished_at: Date | null; rolled_back_at: Date | null }[]>`
      SELECT migration_name, finished_at, rolled_back_at FROM _prisma_migrations`
      .then(async (rows) => {
        const s = migrationStatus(await migrationFolder(), rows);
        return { applied: s.applied, pending: s.pending.length, failed: s.failed.length, unknown: s.unknown.length };
      }, () => null),
  ]);
  return formatTechInfo({
    version: (pkg as { version?: string }).version ?? "?",
    commit: process.env.NEXT_PUBLIC_GIT_COMMIT ?? "",
    buildId: await buildId(),
    official: (process.env.NEXT_PUBLIC_OFFICIAL_BUILD || null) as InstallKind | null,
    node: process.version,
    platform: `${process.platform}/${process.arch}`,
    postgres,
    migrations,
    envSet: Object.entries(presence).filter(([, v]) => v !== "unset").map(([k]) => k),
    envInvalid: Object.entries(presence).filter(([, v]) => v === "invalid").map(([k]) => k),
    features: Object.entries(flags).filter(([, on]) => on).map(([k]) => k),
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  });
}
