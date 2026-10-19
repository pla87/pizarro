"use client";

import { Search } from "lucide-react";
import { useMemo, useState } from "react";
import { ReleaseEntry } from "./ReleaseEntry";

type Release = React.ComponentProps<typeof ReleaseEntry>["release"];

/** Minúsculas y sin acentos, para buscar sin distinguir ni mayúsculas ni tildes. */
const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Releases con un buscador por título y contenido (se filtra en el cliente sobre todas las cargadas). */
export function ReleasesList({ releases }: { releases: Release[] }) {
  const [query, setQuery] = useState("");
  const index = useMemo(() => releases.map((r) => ({ r, text: fold(`${r.title}\n${r.content}`) })), [releases]);
  const q = fold(query.trim());
  const shown = q ? index.filter((x) => x.text.includes(q)).map((x) => x.r) : releases;

  return (
    <div>
      <div className="mb-4">
        <div className="relative">
          <Search size={16} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-slate-400" />
          <input
            type="search"
            className="input pl-9"
            placeholder="Buscar en título y contenido…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Buscar releases"
          />
        </div>
        {q && <p className="mt-1 text-xs text-slate-500" aria-live="polite">{shown.length} de {releases.length} releases</p>}
      </div>
      {shown.length === 0 ? (
        <p className="card p-6 text-center text-sm text-slate-500">Ninguna release coincide con «{query.trim()}».</p>
      ) : (
        <div className="space-y-3">
          {shown.map((r) => <ReleaseEntry key={r.id} release={r} />)}
        </div>
      )}
    </div>
  );
}
