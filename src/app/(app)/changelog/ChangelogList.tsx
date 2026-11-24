"use client";

import { Loader2, Search } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { getOlderVersions } from "@/actions/changelog";
import { CHANGE_CATEGORIES, versionAnchor, versionFromHash, type ChangelogVersion, type Changes } from "@/lib/changelog-core";
import { useIntlLocale, useT } from "@/i18n/client";
import { formatDate } from "@/lib/format";
import { normalizeSearch } from "@/lib/search-accents";
import { actionThrowMessage } from "@/lib/stale-action";
import { EmailSafe } from "@/components/ui/EmailSafe";

/**
 * Versiones con un buscador por número, resumen y cambios; al buscar solo se muestran los cambios que coinciden. La
 * página trae solo las más recientes: las anteriores llegan todas de una vez con «Ver más», al escribir en el buscador
 * (se busca en todas) o al abrir el enlace de una versión antigua (`/changelog#v1.2.3`).
 */
export function ChangelogList({ initial, total: initialTotal, currentVersion }: { initial: ChangelogVersion[]; total: number; currentVersion: string }) {
  const t = useT();
  const locale = useIntlLocale();
  const [versions, setVersions] = useState(initial);
  const [total, setTotal] = useState(initialTotal);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Versión a la que ir cuando lleguen las demás (enlace a una antigua) y la primera de las cargadas con «Ver más».
  const scrollTo = useRef<string | null>(null);
  const focusTo = useRef<string | null>(null);
  const inFlight = useRef(false);
  const complete = versions.length >= total;
  const [query, setQuery] = useState("");
  const q = normalizeSearch(query.trim());
  const has = (s: string) => normalizeSearch(s).includes(q);

  /** Trae las que faltan; con `focusFirst` («Ver más»), el foco pasa a la primera de las nuevas. */
  const loadRest = useCallback(async (focusFirst = false) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setLoading(true);
    setError(null);
    try {
      const res = await getOlderVersions(initial.length);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      if (focusFirst) focusTo.current = res.data.versions[0]?.version ?? null;
      setVersions([...initial, ...res.data.versions]);
      setTotal(initial.length + res.data.versions.length);
    } catch (err) {
      setError(actionThrowMessage(err, t));
    } finally {
      inFlight.current = false;
      setLoading(false);
    }
  }, [initial, t]);

  // Enlace a una versión que no está entre las primeras: se traen las demás y se baja hasta ella.
  useEffect(() => {
    const go = () => {
      const v = versionFromHash(window.location.hash);
      if (!v || complete || versions.some((x) => x.version === v)) return;
      scrollTo.current = v;
      void loadRest();
    };
    go();
    window.addEventListener("hashchange", go);
    return () => window.removeEventListener("hashchange", go);
  }, [complete, versions, loadRest]);
  // Ya pintadas las que llegaron: se baja a la del enlace o se lleva el foco a la primera de las nuevas.
  useEffect(() => {
    if (scrollTo.current) document.getElementById(versionAnchor(scrollTo.current))?.scrollIntoView();
    if (focusTo.current) document.getElementById(versionAnchor(focusTo.current))?.focus();
    scrollTo.current = focusTo.current = null;
  }, [versions]);

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
            placeholder={t("Buscar por versión, resumen o cambio…")}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              // La primera vez que se busca se traen las versiones que faltan, para buscar en todas.
              if (e.target.value.trim() && !complete) void loadRest();
            }}
            aria-label={t("Buscar en el historial")}
          />
        </div>
        <p className="mt-1 text-xs text-slate-500" aria-live="polite">
          {q && loading ? (
            <span className="inline-flex items-center gap-1"><Loader2 size={12} className="animate-spin" aria-hidden />{t("Buscando en todas las versiones…")}</span>
          ) : q ? (
            t("{n} de {total} versiones", { n: shown.length, total })
          ) : null}
        </p>
      </div>
      <ol className="relative space-y-6 border-l-2 border-slate-200 pl-6 dark:border-slate-800">
        {shown.map(({ v, changes }) => (
          <li key={v.id} id={versionAnchor(v.version)} tabIndex={-1} className="relative scroll-mt-4 outline-none">
            <span className="absolute top-1.5 -left-[31px] h-3 w-3 rounded-full border-2 border-white bg-brand-600 dark:border-slate-950" />
            <div className="card p-5">
              <div className="flex flex-wrap items-baseline gap-x-3">
                <h2 className="font-mono text-lg font-semibold">
                  <a href={`#${versionAnchor(v.version)}`} className="hover:underline">v{v.version}</a>
                </h2>
                <time className="text-sm text-slate-500" dateTime={v.releasedAt}>
                  {formatDate(v.releasedAt, "dateLong", locale)} · {formatDate(v.releasedAt, "time", locale)}
                </time>
                {v.version === currentVersion && <span className="badge bg-emerald-100 text-emerald-800 ring-emerald-600/20">{t("actual")}</span>}
              </div>
              {/* EmailSafe: una nota puede llevar un email (p. ej. la dirección de los informes) y un proxy que reescribe emails rompería la hidratación. */}
              {v.summary && <p className="mt-1 text-sm text-slate-600 dark:text-slate-300"><EmailSafe text={v.summary} /></p>}
              <div className="mt-3 space-y-3">
                {CHANGE_CATEGORIES.map((cat) =>
                  changes[cat.key].length ? (
                    <div key={cat.key}>
                      <h3 className="text-xs font-semibold tracking-wide text-slate-500 uppercase">{t(cat.label)}</h3>
                      <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm">
                        {changes[cat.key].map((c, i) => <li key={i}><EmailSafe text={c} /></li>)}
                      </ul>
                    </div>
                  ) : null,
                )}
              </div>
            </div>
          </li>
        ))}
        {total === 0 && <li className="text-sm text-slate-500">{t("Sin datos. Ejecuta")} <code>npm run changelog:sync</code>.</li>}
        {total > 0 && shown.length === 0 && !loading && <li className="text-sm text-slate-500">{t("Ninguna versión coincide con «{query}».", { query: query.trim() })}</li>}
      </ol>
      {error && (
        <p role="alert" className="mt-4 text-sm text-red-600 dark:text-red-400">
          {error}{" "}
          <button type="button" className="underline" onClick={() => void loadRest()}>{t("Reintentar")}</button>
        </p>
      )}
      {!complete && !q && !error && (
        <div className="mt-6 flex justify-center">
          <button
            type="button"
            className="btn-secondary"
            disabled={loading}
            aria-busy={loading || undefined}
            onClick={() => void loadRest(true)}
          >
            {loading && <Loader2 size={14} className="animate-spin" aria-hidden />}
            {t("Ver más")}
          </button>
        </div>
      )}
    </div>
  );
}
