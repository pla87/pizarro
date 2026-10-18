import { History } from "lucide-react";
import { db } from "@/lib/db";
import { CHANGE_CATEGORIES, parseChanges } from "@/lib/changelog";
import { requireUserPage } from "@/lib/session";
import pkg from "../../../../package.json";

export const metadata = { title: "Historial de versiones" };

function compareSemver(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pb[i] ?? 0) - (pa[i] ?? 0);
  return 0;
}

export default async function ChangelogPage() {
  await requireUserPage();
  const versions = (await db.appVersionLog.findMany()).sort((a, b) => compareSemver(a.version, b.version));

  return (
    <div className="mx-auto max-w-3xl p-4 md:p-6">
      <div className="mb-6 flex items-center gap-3">
        <History size={22} className="text-brand-600" />
        <div>
          <h1 className="text-xl font-semibold">Historial de versiones</h1>
          <p className="text-sm text-slate-500">
            Versión actual: <span className="rounded bg-brand-50 px-1.5 py-0.5 font-mono font-semibold text-brand-700 dark:bg-brand-500/15 dark:text-brand-100">v{pkg.version}</span>
          </p>
        </div>
      </div>
      <ol className="relative space-y-6 border-l-2 border-slate-200 pl-6 dark:border-slate-800">
        {versions.map((v) => {
          const changes = parseChanges(v.changes);
          return (
            <li key={v.id} className="relative">
              <span className="absolute top-1.5 -left-[31px] h-3 w-3 rounded-full border-2 border-white bg-brand-600 dark:border-slate-950" />
              <div className="card p-5">
                <div className="flex flex-wrap items-baseline gap-x-3">
                  <h2 className="font-mono text-lg font-semibold">v{v.version}</h2>
                  <time className="text-sm text-slate-500" dateTime={v.releasedAt.toISOString()}>
                    {v.releasedAt.toLocaleDateString("es-ES", { dateStyle: "long", timeZone: "UTC" })}
                  </time>
                  {v.version === pkg.version && <span className="badge bg-emerald-100 text-emerald-800 ring-emerald-600/20">actual</span>}
                </div>
                {v.summary && <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">{v.summary}</p>}
                <div className="mt-3 space-y-3">
                  {CHANGE_CATEGORIES.map((cat) =>
                    changes[cat.key].length ? (
                      <div key={cat.key}>
                        <h3 className="text-xs font-semibold tracking-wide text-slate-500 uppercase">{cat.label}</h3>
                        <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm">
                          {changes[cat.key].map((c, i) => <li key={i}>{c}</li>)}
                        </ul>
                      </div>
                    ) : null,
                  )}
                </div>
              </div>
            </li>
          );
        })}
        {versions.length === 0 && <li className="text-sm text-slate-500">Sin datos. Ejecuta <code>npm run changelog:sync</code>.</li>}
      </ol>
    </div>
  );
}
