"use client";

import { Search } from "lucide-react";
import { useState } from "react";
import { CHANGE_CATEGORIES, type Changes } from "@/lib/changelog";

interface VersionRow {
  id: string;
  version: string;
  releasedAt: string;
  summary: string;
  changes: Changes;
}

/** Minúsculas y sin acentos, para buscar sin distinguir ni mayúsculas ni tildes. */
const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Versiones con un buscador por número, resumen y cambios; al buscar solo se muestran los cambios que coinciden. */
export function ChangelogList({ versions, currentVersion }: { versions: VersionRow[]; currentVersion: string }) {
  const [query, setQuery] = useState("");
  const q = fold(query.trim());
  const has = (s: string) => fold(s).includes(q);

  const shown = versions.flatMap((v) => {
    if (!q) return [{ v, changes: v.changes }];
    const header = has(`v${v.version} ${v.version}`) || has(v.summary);
    const changes = Object.fromEntries(
      CHANGE_CATEGORIES.map((c) => [c.key, header ? v.changes[c.key] : v.changes[c.key].filter(has)]),
    ) as Changes;
    const any = CHANGE_CATEGORIES.some((c) => changes[c.key].length);
    // Si solo coincide la cabecera (número o resumen) se muestran todos sus cambios.
    return header || any ? [{ v, changes }] : [];
  });

  return (
    <div>
      <div className="mb-5">
        <div className="relative">
          <Search size={16} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-slate-400" />
          <input
            type="search"
            className="input pl-9"
            placeholder="Buscar por versión, resumen o cambio…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Buscar en el historial"
          />
        </div>
        {q && <p className="mt-1 text-xs text-slate-500" aria-live="polite">{shown.length} de {versions.length} versiones</p>}
      </div>
      <ol className="relative space-y-6 border-l-2 border-slate-200 pl-6 dark:border-slate-800">
        {shown.map(({ v, changes }) => (
          <li key={v.id} className="relative">
            <span className="absolute top-1.5 -left-[31px] h-3 w-3 rounded-full border-2 border-white bg-brand-600 dark:border-slate-950" />
            <div className="card p-5">
              <div className="flex flex-wrap items-baseline gap-x-3">
                <h2 className="font-mono text-lg font-semibold">v{v.version}</h2>
                <time className="text-sm text-slate-500" dateTime={v.releasedAt}>
                  {new Date(v.releasedAt).toLocaleDateString("es-ES", { dateStyle: "long", timeZone: "UTC" })}
                </time>
                {v.version === currentVersion && <span className="badge bg-emerald-100 text-emerald-800 ring-emerald-600/20">actual</span>}
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
        ))}
        {versions.length === 0 && <li className="text-sm text-slate-500">Sin datos. Ejecuta <code>npm run changelog:sync</code>.</li>}
        {versions.length > 0 && shown.length === 0 && <li className="text-sm text-slate-500">Ninguna versión coincide con «{query.trim()}».</li>}
      </ol>
    </div>
  );
}
