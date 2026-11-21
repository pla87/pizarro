// «Otra persona ha cambiado esto mientras lo editabas» en los formularios de Administración (plantillas de proyecto, textos
// legales, ajustes). Sin zod ni nada del servidor: lo usan las acciones y los formularios.
//
// El formulario recuerda la versión de lo que abrió (`since`) y la manda al guardar; si lo guardado ya no es eso, la acción
// no pisa nada y falla con el código `edit_conflict`. Las tareas tienen su propio mecanismo, campo a campo (text-version.ts).
import { textHash } from "./text-version";

export const EDIT_CONFLICT_CODE = "edit_conflict";

/** Texto del aviso (la clave en español; el servidor lo traduce al idioma de quien guarda). */
export const EDIT_CONFLICT_MESSAGE = "Otra persona ha cambiado esto mientras lo editabas.";

/** Versión de unos valores guardados: una huella corta de su JSON (el mismo orden de claves da la misma huella). */
export function editVersion(values: unknown): string {
  return textHash(JSON.stringify(values) ?? "");
}

/** El guardado falló porque otra persona cambió lo mismo antes. */
export function isEditConflict(res: { ok: boolean; code?: string }): boolean {
  return !res.ok && res.code === EDIT_CONFLICT_CODE;
}
