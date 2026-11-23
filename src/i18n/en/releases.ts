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
  "Aún no hay releases. Se generan con el botón «Generar release» de la columna «{name}» del tablero.": "There are no releases yet. Releases are created with the “Generate release” button in the “{name}” column on the board.",
  "Aún no hay releases. Se generan con el botón «Generar release» de la columna que tenga el rol «{role}»: elígelo en el menú de una columna del tablero, en «Rol de la columna».": "There are no releases yet. Releases are created with the “Generate release” button in the column with the “{role}” role: pick it in a column's menu on the board, under “Column role”.",
  // Topes de una release (RELEASE_MAX_TASKS y RELEASE_MAX_ATTACHMENT_TASKS en src/lib/release.ts)
  "Una release admite como mucho 500 tareas: quita alguna de la selección.": "A release holds at most 500 tasks: remove some from the selection.",
  "Una release admite como mucho 200 tareas con adjuntos: quita alguna de la selección.": "A release holds at most 200 tasks with attachments: remove some from the selection.",
  // Historial de la tarea al desplegar una release
  "Movió la tarea a «{to}» al desplegar la release «{title}»": "Moved the task to “{to}” when deploying the release “{title}”",
  "Archivó la tarea al desplegar la release «{title}»": "Archived the task when deploying the release “{title}”",

  // «Generar release» con un filtro activo en el tablero
  "El filtro del tablero no se aplica aquí: la lista incluye 1 tarea que el filtro oculta.": "The board filter doesn't apply here: the list includes 1 task the filter hides.",
  "El filtro del tablero no se aplica aquí: la lista incluye {n} tareas que el filtro oculta.": "The board filter doesn't apply here: the list includes {n} tasks the filter hides.",
  // Menú «⋯» de una release del histórico (Borrar adjuntos, Borrar release)
  "Más acciones de la release R{number}": "More actions for release R{number}",
  // ZIP de adjuntos: un POST sin ?plan=1 (el envío directo de antes de la v1.60) ya no se sirve
  "Pide primero el plan de descarga (?plan=1); si la página es de antes de actualizar Pizarro, recárgala.": "Request the download plan first (?plan=1); if the page was opened before Pizarro was updated, reload it.",
  // Histórico de releases: como mucho LIST_MAX en la página; las más antiguas, buscando
  "Hay releases más antiguas: búscalas por su título o su contenido.": "There are older releases: search for them by title or content.",
  // Búsqueda con más coincidencias de las que caben en la página
  "se muestran las más recientes; afina la búsqueda para ver otras.": "showing the most recent; refine the search to see others.",
  // ZIP de adjuntos: un paquete sin ?part= o sin ?v= (enlaces de antes de la v1.60) ya no se sirve
  "Falta el paquete del ZIP o su versión (?part=N&v=…): descárgalo desde la página; si es de antes de actualizar Pizarro, recárgala.": "The ZIP package or its version is missing (?part=N&v=…): download it from the page; if the page was opened before Pizarro was updated, reload it.",
  // Botón «Generar release» de la columna sin tarjetas: el motivo dice qué hacer (ronda de releases desplegadas al buscar)
  "Añade tarjetas a esta columna para generar la release": "Add cards to this column to generate the release",
  // Códigos de tarea de una release (R3F1 = release 3 + letras del tipo + orden), al pasar el ratón
  "Release nº {number}. Sus tareas llevan el código R{number} + las letras de su tipo + su orden dentro del tipo (R{number}F1, R{number}F2, R{number}C1…).": "Release no. {number}. Its tasks get the code R{number} + their type's letters + their order within the type (R{number}F1, R{number}F2, R{number}C1…).",
  "Código de release: R{number} = release nº {number}; {letters} = letras del tipo; {order} = orden dentro del tipo": "Release code: R{number} = release no. {number}; {letters} = type letters; {order} = order within the type",
  // Generar release: qué hace (paso 1)
  "Notas de versión en Markdown con estas tareas, agrupadas por tipo. Al marcarla como desplegada se guarda en el histórico y el título de cada tarea (salvo las fijas) pasa a empezar por su código, p. ej. «R{number}F1: …».": "Release notes in Markdown with these tasks, grouped by type. When you mark it as deployed, it is saved in the history and each task's title (except fixed ones) starts with its code, e.g. “R{number}F1: …”.",
};
