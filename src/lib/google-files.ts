// Archivos de Google que se crean desde una tarjeta y quedan enlazados en ella (TaskLink.kind). Sin dependencias de
// servidor: lo usan las acciones, la exportación de proyectos y los editores (comandos @docs / @sheets / @slides).

export const GOOGLE_FILE_KINDS = ["GOOGLE_DOC", "GOOGLE_SHEET", "GOOGLE_SLIDES"] as const;
export type GoogleFileKind = (typeof GOOGLE_FILE_KINDS)[number];
