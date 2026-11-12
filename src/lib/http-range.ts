// Descargas reanudables: interpreta la cabecera Range (un solo rango de bytes) y If-Range. Sin dependencias del servidor.

type RangeResult =
  | { kind: "full" }
  | { kind: "partial"; start: number; end: number }
  | { kind: "invalid" };

/**
 * Interpreta `Range: bytes=…` para un archivo de `size` bytes. Sin cabecera o con otra unidad se sirve entero (se ignora);
 * un rango múltiple también se ignora (se sirve entero, que el estándar permite); uno mal formado o fuera del
 * archivo es «invalid» (416). `end` es inclusivo.
 */
export function parseRange(header: string | null | undefined, size: number): RangeResult {
  if (!header) return { kind: "full" };
  const m = /^\s*bytes\s*=\s*(.*)$/i.exec(header);
  if (!m) return { kind: "full" };
  const spec = m[1]!.trim();
  if (spec.includes(",")) return { kind: "full" };
  const r = /^(\d*)\s*-\s*(\d*)$/.exec(spec);
  if (!r || (r[1] === "" && r[2] === "")) return { kind: "invalid" };
  if (r[1] === "") {
    // Sufijo: los últimos N bytes.
    const n = Number(r[2]);
    if (!Number.isSafeInteger(n) || n <= 0 || size === 0) return { kind: "invalid" };
    return { kind: "partial", start: Math.max(0, size - n), end: size - 1 };
  }
  const start = Number(r[1]);
  const end = r[2] === "" ? size - 1 : Number(r[2]);
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= size) return { kind: "invalid" };
  return { kind: "partial", start, end: Math.min(end, size - 1) };
}

/** ETag fuerte de un archivo que no cambia: identificador del trabajo, tamaño y fecha de fin. */
export function strongEtag(id: string, size: number, finishedAt: Date | null): string {
  return `"${id}-${size}-${finishedAt ? finishedAt.getTime() : 0}"`;
}

/** If-Range: el rango solo vale si el validador coincide con el ETag actual (comparación fuerte; una fecha no se admite). */
export function ifRangeMatches(ifRange: string | null | undefined, etag: string): boolean {
  if (!ifRange) return true;
  return ifRange.trim() === etag;
}
