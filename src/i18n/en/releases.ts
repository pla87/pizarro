// Releases: generar, desplegar y sus adjuntos. Clave: texto exacto en español.
export const releases: Record<string, string> = {
  // Release: tareas movidas de columna mientras se preparaba y texto fijo de las release notes
  "Una de las tareas se ha movido a otra columna mientras tanto: vuelve a generar la release.": "One of the tasks has been moved to another column in the meantime: generate the release again.",
  "{n} de las tareas se han movido a otra columna mientras tanto: vuelve a generar la release.": "{n} of the tasks have been moved to another column in the meantime: generate the release again.",
  "Otros": "Others",
  "Sin tareas seleccionadas.": "No tasks selected.",

  // Release: tareas renombradas mientras se preparaba
  "Una de las tareas ha cambiado de título mientras tanto: vuelve a generar la release.": "One of the tasks has been renamed in the meantime: generate the release again.",
  "{n} de las tareas han cambiado de título mientras tanto: vuelve a generar la release.": "{n} of the tasks have been renamed in the meantime: generate the release again.",

  // Adjunto de una release
  "¿Borrar el adjunto de esta release? El texto se conserva.": "Delete this release's attachment? The text is kept.",

  // Histórico vacío: con el nombre real de la columna que genera releases, o cómo crearla si no hay
  "Aún no hay releases. Genera una desde la columna «{name}» del tablero.": "There are no releases yet. Generate one from the “{name}” column on the board.",
  "Aún no hay releases. Para generarlas, elige en el menú de una columna del tablero el rol «{role}».": "There are no releases yet. To generate them, choose the “{role}” role in the menu of a column on the board.",
  // Topes de una release (RELEASE_MAX_TASKS y RELEASE_MAX_ATTACHMENT_TASKS en src/lib/release.ts)
  "Una release admite como mucho 500 tareas: quita alguna de la selección.": "A release holds at most 500 tasks: remove some from the selection.",
  "Una release admite como mucho 200 tareas con adjuntos: quita alguna de la selección.": "A release holds at most 200 tasks with attachments: remove some from the selection.",
};
