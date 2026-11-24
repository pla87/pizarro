// Mensajes del registro (Administración → Logs) en el idioma de quien los lee. El mensaje se guarda en español (lo que
// sale en los registros del servidor y lo que busca «Buscar» en español); si el evento trae una plantilla traducible (la
// de describeAction en las acciones, o `label` en logEvent), se guarda también en los detalles con la clave LOG_LABEL_KEY
// y la página la pinta traducida, y el texto en inglés va en `messageEn` (lo que busca «Buscar» en inglés; ver
// englishLogMessage). Los eventos sin plantilla (texto libre, versiones anteriores) salen tal cual.
import { makeT } from "@/i18n/core";
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

/** Plantilla de una lista («título y tipo», andList). */
const LIST_KEY = "{list} y {last}";
/** Texto de reserva de una lista que llegó sin sus elementos. */
const LIST_FALLBACK: Label = { k: "varios campos" };

/**
 * Lo que versiones anteriores guardaron recortado: una lista cuyos elementos se quedaron en «[…]» (el tope de
 * profundidad de los detalles) o «…» (el de las plantillas) se leía «Modificó «X»: […] y […]». Ahora, «varios campos».
 */
function repairLabel(label: Label): Label {
  if (!label.p) return label;
  if (label.k === LIST_KEY && ((!isObject(label.p.list) && !Array.isArray(label.p.list)) || !isObject(label.p.last))) return LIST_FALLBACK;
  const p: Record<string, unknown> = {};
  for (const [name, v] of Object.entries(label.p)) p[name] = Array.isArray(v) ? v.map(repairLabel) : isObject(v) ? repairLabel(v as Label) : v;
  return { k: label.k, p: p as Label["p"] };
}

/**
 * Mensaje en el idioma de `t`: la plantilla guardada si la hay y es válida; si no, el texto guardado, traducido si es
 * un texto fijo del diccionario (los errores de las acciones, «OK») y tal cual si no (texto libre con datos dentro).
 * `legacy` (log-legacy.ts, solo para leer en inglés): la plantilla que reproduce el texto de una fila antigua sin ella.
 */
export function logMessageText(row: { message: string; details: Json }, t: T, legacy?: (message: string) => Label | null): string {
  const label = isObject(row.details) ? row.details[LOG_LABEL_KEY] : undefined;
  if (label !== undefined && validLabel(label)) return renderLabel(repairLabel(label), t);
  if (!row.message) return row.message;
  const fixed = t(row.message);
  if (fixed !== row.message || !legacy) return fixed;
  const found = legacy(row.message);
  return found ? renderLabel(found, t) : fixed;
}

/** Detalles sin la plantilla del mensaje (null si no queda nada). */
export function logDetailsShown(details: Json): Json {
  if (!isObject(details) || !(LOG_LABEL_KEY in details)) return details ?? null;
  const rest = { ...details };
  delete rest[LOG_LABEL_KEY];
  return Object.keys(rest).length ? rest : null;
}

const enT = makeT("en");

/**
 * Texto en inglés que se guarda en `AppLog.messageEn` (el que busca «Buscar» en inglés): el mismo que pinta la página
 * (logMessageText sin las filas antiguas). Null si coincide con el español (texto libre sin traducción): el buscador mira
 * entonces el mensaje en español, igual que en las filas anteriores a la columna.
 */
export function englishLogMessage(row: { message: string; details: Json }): string | null {
  const en = logMessageText(row, enT);
  return en && en !== row.message ? en : null;
}
