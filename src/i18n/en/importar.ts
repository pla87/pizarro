// Traducciones al inglés (importar desde Trello JSON y CSV). Clave: texto exacto en español.
export const importar: Record<string, string> = {
  // Panel
  "Desde un .pizarro.zip de Pizarro, un JSON de Trello o un CSV de tareas.": "From a Pizarro .pizarro.zip, a Trello JSON or a tasks CSV.",
  "Archivo (.zip, .json o .csv)": "File (.zip, .json or .csv)",
  "1 usuario se ha añadido como miembro del proyecto por ser responsable de alguna tarea.": "1 user was added as a project member because they are the assignee of some task.",
  "{n} usuarios se han añadido como miembros del proyecto por ser responsables de alguna tarea.": "{n} users were added as project members because they are assignees of some task.",
  "Responsables sin emparejar ({n})": "Unmatched assignees ({n})",
  "No hay un usuario activo con ese email o nombre (o el proyecto es privado), así que sus tareas quedan sin asignar y el nombre figura en la descripción.":
    "There is no active user with that email or name (or the project is private), so their tasks are left unassigned and the name appears in the description.",
  "Cosas que no se pudieron importar": "Things that could not be imported",

  // Errores del archivo
  "Formato de archivo no reconocido. Sube un .pizarro.zip de Pizarro, un JSON exportado de Trello o un CSV.": "File format not recognized. Upload a Pizarro .pizarro.zip, a JSON exported from Trello or a CSV.",
  "El archivo supera el tamaño máximo para JSON y CSV ({mb} MB).": "The file exceeds the maximum size for JSON and CSV ({mb} MB).",
  "El archivo no es un JSON válido.": "The file is not valid JSON.",
  "El JSON no parece una exportación de un tablero de Trello (faltan «lists» y «cards»).": "The JSON does not look like a Trello board export (“lists” and “cards” are missing).",
  "El CSV no tiene filas de tareas (solo cabecera o está vacío).": "The CSV has no task rows (header only, or empty).",
  "El CSV tiene demasiadas filas.": "The CSV has too many rows.",
  "El CSV no tiene ninguna fila con título.": "The CSV has no row with a title.",
  "El archivo no tiene ninguna tarea que importar.": "The file has no tasks to import.",
  "Hay más de 30 columnas distintas (máximo 30 por proyecto). Si importas un CSV, revisa que la columna de estado sea la correcta.":
    "There are more than 30 different columns (maximum 30 per project). If you are importing a CSV, check that the status column is the right one.",
  "Hay más de 1000 tareas activas (máximo 1000 por proyecto). Quita o archiva tareas en el origen y vuelve a exportar.":
    "There are more than 1000 active tasks (maximum 1000 per project). Remove or archive tasks at the source and export again.",
  "El CSV no tiene una columna de título reconocible (título, title, name, summary…). Revisa la cabecera de la primera fila.":
    "The CSV has no recognizable title column (título, title, name, summary…). Check the header in the first row.",

  // Textos que se escriben en las tareas
  "Sin nombre": "Unnamed",
  "Adjuntos de Trello": "Trello attachments",
  "Lista de Trello archivada: {name}.": "Archived Trello list: {name}.",
  "Tarjeta original en Trello:": "Original Trello card:",
  "{author} comentó en Trello el {date}:": "{author} commented on Trello on {date}:",
  "{author} comentó en Trello:": "{author} commented on Trello:",
  "Referencia original: {key}": "Original reference: {key}",
  "Subtarea de: {name}.": "Subtask of: {name}.",
  "Responsable en el archivo original: {names}.": "Assignee in the original file: {names}.",

  // Avisos del resumen
  "{n} textos eran más largos de lo permitido y se han recortado.": "{n} texts were longer than allowed and have been shortened.",
  "{n} archivos adjuntos subidos a Trello no se han importado (solo se importan los enlaces).": "{n} files uploaded to Trello were not imported (only links are imported).",
  "{n} fechas límite no se pudieron interpretar y se han ignorado.": "{n} due dates could not be understood and were ignored.",
  "{n} prioridades no se reconocieron y se han ignorado.": "{n} priorities were not recognized and were ignored.",
  "{n} filas no tenían título y se han ignorado.": "{n} rows had no title and were ignored.",
  "{n} tarjetas no tenían título y se han ignorado.": "{n} cards had no title and were ignored.",
  "{n} etiquetas de tareas sobraban (máximo {max} por tarea) y no se han importado.": "{n} task labels were over the limit ({max} per task) and were not imported.",
  "{n} elementos de checklist sobraban (máximo {max} subtareas por tarea) y no se han importado.": "{n} checklist items were over the limit ({max} subtasks per task) and were not imported.",
  "{n} subtareas sobraban (máximo {max} por tarea) y no se han importado.": "{n} subtasks were over the limit ({max} per task) and were not imported.",
  "{n} comentarios antiguos no se han importado: de cada tarjeta con más de {max} se guardan los {max} más recientes.":
    "{n} older comments were not imported: for each card with more than {max}, the {max} most recent are kept.",
  "{n} etiquetas sobraban (máximo {max} por proyecto) y no se han importado.": "{n} labels were over the limit ({max} per project) and were not imported.",
  "{n} tareas archivadas sobraban (máximo {max}) y no se han importado.": "{n} archived tasks were over the limit ({max}) and were not imported.",

  // Avisos de importación con un solo elemento (antes «1 títulos eran…»)
  "1 título era más largo de lo permitido y se ha recortado.": "1 title was longer than allowed and has been shortened.",
  "1 enlace de Google no tenía una dirección válida de Google y no se ha importado.": "1 Google link did not have a valid Google address and was not imported.",
  "1 tarjeta no tenía título y se ha ignorado.": "1 card had no title and was ignored.",
  "1 texto era más largo de lo permitido y se ha recortado.": "1 text was longer than allowed and has been shortened.",
  "1 archivo adjunto subido a Trello no se ha importado (solo se importan los enlaces).": "1 file uploaded to Trello was not imported (only links are imported).",
  "1 fecha límite no se pudo interpretar y se ha ignorado.": "1 due date could not be understood and was ignored.",
  "1 etiqueta de tarea sobraba (máximo {max} por tarea) y no se ha importado.": "1 task label was over the limit ({max} per task) and was not imported.",
  "1 elemento de checklist sobraba (máximo {max} subtareas por tarea) y no se ha importado.": "1 checklist item was over the limit ({max} subtasks per task) and was not imported.",
  "1 comentario antiguo no se ha importado: de cada tarjeta con más de {max} se guardan los {max} más recientes.": "1 older comment was not imported: for each card with more than {max}, the {max} most recent are kept.",
  "1 fila no tenía título y se ha ignorado.": "1 row had no title and was ignored.",
  "1 prioridad no se reconoció y se ha ignorado.": "1 priority was not recognized and was ignored.",
  "1 subtarea sobraba (máximo {max} por tarea) y no se ha importado.": "1 subtask was over the limit ({max} per task) and was not imported.",
  "1 etiqueta sobraba (máximo {max} por proyecto) y no se ha importado.": "1 label was over the limit ({max} per project) and was not imported.",
  "1 tarea archivada sobraba (máximo {max}) y no se ha importado.": "1 archived task was over the limit ({max}) and was not imported.",

  // Resumen de la importación: cada número en singular o plural, y las notas de quien no se pudo emparejar
  "«{name}» se ha creado con {items}.": "“{name}” was created with {items}.",
  "(1 archivada)": "(1 archived)",
  "({n} archivadas)": "({n} archived)",
  "1 release": "1 release",
  "{n} releases": "{n} releases",
  "1 documento": "1 document",
  "{n} documentos": "{n} documents",
  "1 tarjeta lleva un comentario con quién la tenía asignada o la creó en el original, porque esa persona no está aquí.":
    "1 card has a comment saying who it was assigned to or created by in the original, because that person is not here.",
  "{n} tarjetas llevan un comentario con quién las tenía asignadas o las creó en el original, porque esas personas no están aquí.":
    "{n} cards have a comment saying who they were assigned to or created by in the original, because those people are not here.",
  "«{name}» importado (1 tarjeta).": "“{name}” imported (1 card).",
  // Importar un proyecto con los topes de la aplicación (30 columnas, nombres de 40)
  "El proyecto tenía {total} columnas y el máximo es {max}: la última se ha unido a «{name}», con sus tareas.":
    "The project had {total} columns and the maximum is {max}: the last one has been merged into “{name}”, with its tasks.",
  "El proyecto tenía {total} columnas y el máximo es {max}: las {n} últimas se han unido a «{name}», con sus tareas.":
    "The project had {total} columns and the maximum is {max}: the last {n} have been merged into “{name}”, with their tasks.",
  "1 nombre de tipo pasaba de {max} caracteres y se ha recortado.": "1 type name was longer than {max} characters and has been shortened.",
  "{n} nombres de tipo pasaban de {max} caracteres y se han recortado.": "{n} type names were longer than {max} characters and have been shortened.",
  "1 nombre de etiqueta pasaba de {max} caracteres y se ha recortado.": "1 label name was longer than {max} characters and has been shortened.",
  "{n} nombres de etiqueta pasaban de {max} caracteres y se han recortado.": "{n} label names were longer than {max} characters and have been shortened.",
  // Fechas con barras: un solo orden día/mes por archivo
  "Hay fechas en dos formatos (día/mes y mes/día): las que valen de las dos maneras (como 03/04/2026) se han leído como {order}. Revísalas.":
    "Dates come in two formats (day/month and month/day): the ones that work both ways (like 03/04/2026) were read as {order}. Please check them.",
  "día/mes": "day/month",
  "mes/día": "month/day",
};
