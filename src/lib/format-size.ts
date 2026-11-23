/** Tamaño legible con KB, MB o GB según la magnitud: «840 KB», «2,3 MB», «1,25 GB». */
export function formatSize(bytes: number, locale = "es-ES"): string {
  const nf = (n: number, digits: number) => new Intl.NumberFormat(locale, { maximumFractionDigits: digits }).format(n);
  if (bytes < 1024 * 1024) return `${nf(Math.max(bytes > 0 ? 1 : 0, Math.round(bytes / 1024)), 0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${nf(bytes / 1024 / 1024, 1)} MB`;
  return `${nf(bytes / 1024 / 1024 / 1024, 2)} GB`;
}

/**
 * Porcentaje entero con la costumbre del idioma: «40 %» en español (con espacio) y «40%» en inglés americano (sin él).
 * `pct` va de 0 a 100. El espacio duro de Intl sale como espacio normal (mismo HTML en el servidor y en el navegador).
 */
export function formatPercent(pct: number, locale = "es-ES"): string {
  return new Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits: 0 }).format(pct / 100).replace(/[\u00a0\u202f]/g, " ");
}

/** Cuota en MB legible: «10 GB», «500 MB». */
export function formatQuotaMb(mb: number, locale = "es-ES"): string {
  return formatSize(mb * 1024 * 1024, locale);
}

/**
 * Tamaño para los mensajes del registro (igual en los dos idiomas: punto decimal): «512 B» por debajo de 1 KB, «840 KB»
 * por debajo de 10 MB, y por encima MB o GB con un decimal («54.7 GB»), para que una cifra grande se lea de un vistazo.
 */
export function logSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 10 * 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}
