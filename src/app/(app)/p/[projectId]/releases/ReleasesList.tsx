"use client";

import { Search } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ReleaseEntry } from "./ReleaseEntry";

type Release = React.ComponentProps<typeof ReleaseEntry>["release"];

/** Releases con buscador en el servidor (título y contenido, sobre todo el histórico) vía ?q=. */
export function ReleasesList({
  releases,
  query,
  resultCount,
  moreHref,
}: {
  releases: Release[];
  query: string;
  resultCount: number | null;
  moreHref: string | null;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [text, setText] = useState(query);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  function onChange(value: string) {
    setText(value);
    if (timer.current) clearTimeout(timer.current);
    // Con debounce: el input responde al instante y la URL (y la consulta) se actualiza al parar de escribir.
    timer.current = setTimeout(() => {
      const q = value.trim();
      if (q === query) return;
      router.replace(q ? `${pathname}?q=${encodeURIComponent(q)}` : pathname, { scroll: false });
    }, 350);
  }

  return (
    <div>
      <div className="mb-4">
        <div className="relative">
          <Search size={16} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-slate-400" />
          <input
            type="search"
            className="input pl-9"
            placeholder="Buscar en título y contenido…"
            value={text}
            onChange={(e) => onChange(e.target.value)}
            aria-label="Buscar releases"
          />
        </div>
        {resultCount !== null && <p className="mt-1 text-xs text-slate-500" aria-live="polite">{resultCount} resultados</p>}
      </div>
      {releases.length === 0 ? (
        <p className="card p-6 text-center text-sm text-slate-500">Ninguna release coincide con «{query}».</p>
      ) : (
        <div className="space-y-3">
          {releases.map((r) => <ReleaseEntry key={r.id} release={r} />)}
        </div>
      )}
      {moreHref && (
        <div className="mt-4 text-center">
          <Link href={moreHref} scroll={false} className="btn-secondary">Cargar más</Link>
        </div>
      )}
    </div>
  );
}
