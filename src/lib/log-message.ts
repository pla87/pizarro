// Mensajes del registro (Administración → Logs) en el idioma de quien los lee. El mensaje se guarda en español (es lo que
// se busca con «Buscar» y lo que sale en los registros del servidor); si el evento trae una plantilla traducible (la de
// describeAction en las acciones, o `label` en logEvent), se guarda también en los detalles con la clave LOG_LABEL_KEY y
// la página la pinta traducida. Los eventos sin plantilla (texto libre, versiones anteriores) salen tal cual.
import type { T } from "@/i18n/shared";
import { renderLabel, type Label } from "./undo-label";

/** Clave de la plantilla dentro de `details` (no se muestra en los detalles ni sale en el CSV). */
export const LOG_LABEL_KEY = "$msg";

type Json = unknown;

const isObject = (x: Json): x is Record<string, Json> => !!x && typeof x === "object" && !Array.isArray(x);

/** ¿Es una plantilla bien formada (también sus variables anidadas)? Lo guardado pasa por el recorte de los detalles. */
function validLabel(x: Json, depth = 0): x is Label {
  if (!isObject(x) || typeof x.k !== "string" || depth > 4) return false;
  if (x.p === undefined) return true;
  if (!isObject(x.p)) return false;
  return Object.values(x.p).every((v) => typeof v === "string" || typeof v === "number" || validLabel(v, depth + 1) || (Array.isArray(v) && v.every((l) => validLabel(l, depth + 1))));
}

/**
 * Mensaje en el idioma de `t`: la plantilla guardada si la hay y es válida; si no, el texto guardado, traducido si es
 * un texto fijo del diccionario (los errores de las acciones, «OK») y tal cual si no (texto libre con datos dentro).
 */
export function logMessageText(row: { message: string; details: Json }, t: T): string {
  const label = isObject(row.details) ? row.details[LOG_LABEL_KEY] : undefined;
  return label !== undefined && validLabel(label) ? renderLabel(label, t) : row.message && t(row.message);
}

/** Detalles sin la plantilla del mensaje (null si no queda nada). */
export function logDetailsShown(details: Json): Json {
  if (!isObject(details) || !(LOG_LABEL_KEY in details)) return details ?? null;
  const rest = { ...details };
  delete rest[LOG_LABEL_KEY];
  return Object.keys(rest).length ? rest : null;
}
