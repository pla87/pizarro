// Copias de seguridad (última copia buena, aviso de copia mucho menor) y exportar/importar proyectos.
export const datos: Record<string, string> = {
  // Copia mucho menor que la última buena
  "La última copia es mucho menor que la anterior": "The latest backup is much smaller than the previous one",
  "La copia del {date} tiene {n} personas, proyectos y tareas, y la última copia buena, del {goodDate}, tenía {m}.": "The backup from {date} has {n} people, projects and tasks, and the last good backup, from {goodDate}, had {m}.",
  "La copia del {date} tiene {n} ficheros, y la última copia buena, del {goodDate}, tenía {m}.": "The backup from {date} has {n} files, and the last good backup, from {goodDate}, had {m}.",
  "La copia del {date} tiene {n} filas en la base de datos, y la última copia buena, del {goodDate}, tenía {m}.": "The backup from {date} has {n} database rows, and the last good backup, from {goodDate}, had {m}.",
  "¿Se ha perdido la base de datos o el volumen? La retención conserva la última copia buena ({stem}) aunque ya le tocara borrarla. Para recuperarla, sigue los pasos de restauración de docs/INSTALL.md con ese nombre.": "Has the database or the volume been lost? Retention keeps the last good backup ({stem}) even when it would otherwise delete it. To recover it, follow the restore steps in docs/INSTALL.md with that name.",
  "Si has borrado datos a propósito, confírmalo: el aviso desaparece y la copia anterior se borrará cuando le toque.": "If you deleted data on purpose, confirm it: the warning goes away and the earlier backup will be deleted when retention reaches it.",
  "La reducción es correcta": "The reduction is correct",
  "Sí, la reducción es correcta": "Yes, the reduction is correct",
  "Reducción confirmada. La copia anterior se borrará cuando le toque por la retención.": "Reduction confirmed. The earlier backup will be deleted when retention reaches it.",
  "No hay ninguna reducción pendiente de confirmar.": "There is no reduction waiting to be confirmed.",
  "Pizarro: la última copia de seguridad es mucho menor que la anterior": "Pizarro: the latest backup is much smaller than the previous one",
  "¿Se ha perdido la base de datos o el volumen? La retención conserva la última copia buena ({stem}) aunque ya le tocara borrarla.": "Has the database or the volume been lost? Retention keeps the last good backup ({stem}) even when it would otherwise delete it.",
  "Si has borrado datos a propósito, confírmalo en Administración → Copias de seguridad con «La reducción es correcta».": "If you deleted data on purpose, confirm it in Administration → Backups with “The reduction is correct”.",

  // Importar un proyecto
  "La cuota de almacenamiento propia del proyecto ({mb} MB) es menor que sus archivos: se usa la cuota general.": "The project's own storage quota ({mb} MB) is smaller than its files: the general quota is used.",
};
