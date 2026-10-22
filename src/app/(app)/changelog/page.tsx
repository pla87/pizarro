import { History } from "lucide-react";
import { db } from "@/lib/db";
import { parseChanges } from "@/lib/changelog";
import { requireUserPage } from "@/lib/session";
import { getLocale, getT } from "@/i18n/server";
import { ChangelogList } from "./ChangelogList";
import pkg from "../../../../package.json";

export async function generateMetadata() {
  const t = await getT();
  return { title: t("Historial de versiones") };
}

function compareSemver(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pb[i] ?? 0) - (pa[i] ?? 0);
  return 0;
}

export default async function ChangelogPage() {
  await requireUserPage();
  const t = await getT();
  const en = (await getLocale()) === "en";
  const versions = (await db.appVersionLog.findMany()).sort((a, b) => compareSemver(a.version, b.version));

  return (
    <div className="mx-auto max-w-3xl p-4 md:p-6">
      <div className="mb-6 flex items-center gap-3">
        <History size={22} className="text-brand-600 dark:text-brand-300" />
        <div>
          <h1 className="text-xl font-semibold">{t("Historial de versiones")}</h1>
          <p className="text-sm text-slate-500">
            {t("Versión actual:")} <span className="rounded bg-brand-50 px-1.5 py-0.5 font-mono font-semibold text-brand-700 dark:bg-brand-500/15 dark:text-brand-100">v{pkg.version}</span>
          </p>
        </div>
      </div>
      <ChangelogList
        currentVersion={pkg.version}
        versions={versions.map((v) => ({
          id: v.id,
          version: v.version,
          releasedAt: v.releasedAt.toISOString(),
          // En inglés, la traducción si la hay; si no, el texto original.
          summary: en && v.summaryEn ? v.summaryEn : v.summary,
          changes: en && v.changesEn ? parseChanges(v.changesEn) : parseChanges(v.changes),
        }))}
      />
    </div>
  );
}
