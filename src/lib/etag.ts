/**
 * `If-None-Match` puede traer varios ETags (con o sin el prefijo débil `W/`, que proxies y CDN añaden al recomprimir) o `*`.
 * Para decidir un 304 basta la comparación débil: se ignora `W/` en ambos lados.
 */
export function ifNoneMatchHas(header: string | null | undefined, etag: string): boolean {
  if (!header) return false;
  const own = etag.trim().replace(/^W\//, "");
  return header.split(",").some((x) => {
    const v = x.trim().replace(/^W\//, "");
    return v === "*" || v === own;
  });
}
