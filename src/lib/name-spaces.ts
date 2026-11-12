// Nombres (proyectos, columnas, etiquetas, tipos, personas…): los espacios repetidos o raros (dos espacios, espacio
// duro U+00A0, tabuladores) se guardan como un solo espacio normal. Así lo que se ve es lo que se escribe, p. ej. al
// confirmar el borrado de un proyecto tecleando su nombre. Módulo puro: lo usan el cliente y el servidor.

/** Une cualquier racha de espacios en uno normal y quita los de los extremos. */
export function collapseSpaces(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** ¿Es el mismo nombre? Ignora las diferencias de espacios (los nombres guardados antes pueden tener dos seguidos). */
export function sameName(a: string, b: string): boolean {
  return collapseSpaces(a) === collapseSpaces(b);
}
