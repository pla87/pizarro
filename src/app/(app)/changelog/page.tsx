import { History } from "lucide-react";
import { CHANGELOG_FIRST_PAGE } from "@/lib/changelog-core";
import { changelogVersions } from "@/lib/changelog-page";
import { requireUserPage } from "@/lib/session";
import { getLocale, getT } from "@/i18n/server";
import { BugReportLink } from "@/components/BugReportLink";
import { ChangelogList } from "./ChangelogList";
import pkg from "../../../../package.json";

export async function generateMetadata() {
  const t = await getT();
  return { title: t("Historial de versiones") };
}

export default async function ChangelogPage() {
  const user = await requireUserPage();
  const t = await getT();
  // Solo las más recientes: con todas, la página pesaba cientos de KB. Las demás se piden desde la lista.
  const { versions, total } = await changelogVersions({ en: (await getLocale()) === "en", admin: user.role === "ADMIN" }, 0, CHANGELOG_FIRST_PAGE);

  return (
    <div className="mx-auto max-w-3xl p-4 md:p-6">
      <div className="mb-6 flex flex-wrap items-center gap-x-3 gap-y-3">
        <History size={22} className="text-brand-600 dark:text-brand-300" />
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-semibold">{t("Historial de versiones")}</h1>
          <p className="text-sm text-slate-500">
            {t("Versión actual:")} <span className="rounded bg-brand-50 px-1.5 py-0.5 font-mono font-semibold text-brand-700 dark:bg-brand-500/15 dark:text-brand-100">v{pkg.version}</span>
          </p>
        </div>
        <div className="w-full sm:w-auto sm:max-w-xs">
          <BugReportLink />
        </div>
      </div>
      <ChangelogList currentVersion={pkg.version} initial={versions} total={total} />
    </div>
  );
}
