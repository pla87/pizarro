/** Tamaño legible con KB, MB o GB según la magnitud: «840 KB», «2,3 MB», «1,25 GB». */
export function formatSize(bytes: number, locale = "es-ES"): string {
  const nf = (n: number, digits: number) => new Intl.NumberFormat(locale, { maximumFractionDigits: digits }).format(n);
  if (bytes < 1024 * 1024) return `${nf(Math.max(bytes > 0 ? 1 : 0, Math.round(bytes / 1024)), 0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${nf(bytes / 1024 / 1024, 1)} MB`;
  return `${nf(bytes / 1024 / 1024 / 1024, 2)} GB`;
}

/** Cuota en MB legible: «10 GB», «500 MB». */
export function formatQuotaMb(mb: number, locale = "es-ES"): string {
  return formatSize(mb * 1024 * 1024, locale);
}
