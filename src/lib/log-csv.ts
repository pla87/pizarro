// Formato del CSV de logs (Administración → Logs → Descargar CSV), sin dependencias del servidor para poder probarlo.
// Excel en español espera «;» entre columnas (la coma es el separador decimal) y en inglés «,»; el fichero empieza con
// la marca BOM de UTF-8 para que lea bien las tildes.
import type { Locale } from "@/i18n/shared";

/** Separador de columnas según el idioma de quien descarga. */
export function csvSeparator(locale: Locale): ";" | "," {
  return locale === "es" ? ";" : ",";
}

/**
 * Celda CSV: siempre entre comillas dobles (así el separador, las comillas y los saltos de línea del valor no rompen la
 * fila) y con «'» delante si empieza por un carácter que Excel interpretaría como fórmula (=, +, -, @, tabulador, CR).
 */
export function csvCell(v: unknown): string {
  let s = v == null ? "" : typeof v === "string" ? v : JSON.stringify(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}

/** Una fila del CSV (sin el salto de línea final). */
export function csvRow(values: readonly unknown[], sep: string): string {
  return values.map(csvCell).join(sep);
}

/** Marca BOM de UTF-8 con la que empieza el fichero. */
export const CSV_BOM = "\uFEFF";

/** Motivos por los que la descarga vuelve a la página de Logs con un aviso (`?csv=`). */
const LOG_CSV_ERRORS = ["busy", "rate", "order", "too_long", "invalid"] as const;
export type LogCsvError = (typeof LOG_CSV_ERRORS)[number];

export function parseLogCsvError(v: unknown): LogCsvError | null {
  return typeof v === "string" && (LOG_CSV_ERRORS as readonly string[]).includes(v) ? (v as LogCsvError) : null;
}

/** Fecha «AAAA-MM-DD» de un parámetro, para volver a rellenar el formulario; cualquier otra cosa, null. */
export function csvDateParam(v: unknown): string | null {
  return typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
}

/**
 * Dirección de la página sin los parámetros de vuelta de una descarga fallida (`csv`, `desde`, `hasta`), con los filtros
 * de la lista. El aviso de la página los quita al mostrarse: si no, tras una descarga que sí funciona (la página no
 * navega, porque el CSV llega como adjunto) o al recargar, seguía diciendo que no se había descargado.
 */
export function withoutCsvParams(pathname: string, search: string, hash = ""): string {
  const params = new URLSearchParams(search);
  for (const k of ["csv", "desde", "hasta"]) params.delete(k);
  const qs = params.toString();
  return `${pathname}${qs ? `?${qs}` : ""}${hash}`;
}
