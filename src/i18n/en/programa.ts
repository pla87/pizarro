// Traducciones al inglés (columna «Programa del curso»: versiones del PDF guardado y tope de sesiones de la columna).
// Clave: texto exacto en español.
export const programa: Record<string, string> = {
  // Versiones del PDF guardado en Documentación
  "Guardar también en Documentación como una versión nueva («{name}»)": "Also save to Documentation as a new version (“{name}”)",
  "Guardado en Documentación como «{name}» (versión {n} del programa).": "Saved to Documentation as “{name}” (programme version {n}).",
  // Tope de sesiones de una columna «Programa del curso»
  "La columna «{name}» admite como mucho {max} sesiones.": "The column “{name}” holds at most {max} sessions.",
  "La columna «{name}» admite como mucho {max} sesiones: tiene {n} y no caben {adding} más.": "The column “{name}” holds at most {max} sessions: it has {n}, so {adding} more don't fit.",
  "La columna «{name}» tiene {n} tareas y una columna «Programa del curso» admite como mucho {max} sesiones. Mueve o archiva alguna antes de darle ese rol.":
    "The column “{name}” has {n} tasks and a “Course programme” column holds at most {max} sessions. Move or archive some before giving it that role.",
  "El archivo tiene {n} tareas en la columna «{name}» y una columna «Programa del curso» admite como mucho {max} sesiones. Archiva alguna o quítale ese rol antes de exportarlo.":
    "The file has {n} tasks in the column “{name}” and a “Course programme” column holds at most {max} sessions. Archive some or remove that role before exporting it.",
  "Sesiones: {n} de {max} como mucho": "Sessions: {n} of at most {max}",
  "La columna tiene {n} sesiones y el programa admite como mucho {max}: el PDF incluirá solo las {max} primeras.":
    "The column has {n} sessions and the programme holds at most {max}: the PDF will include only the first {max}.",
  "El PDF incluye solo las {max} primeras sesiones: {n} se han quedado fuera.": "The PDF includes only the first {max} sessions: {n} were left out.",
};
