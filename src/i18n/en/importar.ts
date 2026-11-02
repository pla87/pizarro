// Traducciones al inglés (importar desde Trello JSON y CSV). Clave: texto exacto en español.
export const importar: Record<string, string> = {
  // Panel
  "Crea un proyecto a partir de un .pizarro.zip de Pizarro, un JSON exportado de Trello o un CSV de tareas (Asana, Notion, GitHub Projects, Wekan, Kanboard…). El formato se reconoce solo; las personas se emparejan por email o nombre y el nombre del proyecto sale del archivo.":
    "Creates a project from a Pizarro .pizarro.zip, a JSON exported from Trello or a CSV of tasks (Asana, Notion, GitHub Projects, Wekan, Kanboard…). The format is detected automatically; people are matched by email or name and the project name comes from the file.",
  "Archivo (.zip, .json o .csv)": "File (.zip, .json or .csv)",
  "«{name}» se ha creado con {columns} columnas y {tasks} tareas ({archived} archivadas), con {subtasks} subtareas, {labels} etiquetas y {comments} comentarios.":
    "“{name}” was created with {columns} columns and {tasks} tasks ({archived} archived), with {subtasks} subtasks, {labels} labels and {comments} comments.",
  "{n} usuario(s) se han añadido como miembros del proyecto por ser responsables de alguna tarea.": "{n} user(s) were added as project members because they are assignees of some task.",
  "Responsables sin emparejar ({n})": "Unmatched assignees ({n})",
  "No hay un usuario activo con ese email o nombre (o el proyecto es privado), así que sus tareas quedan sin asignar y el nombre figura en la descripción.":
    "There is no active user with that email or name (or the project is private), so their tasks are left unassigned and the name appears in the description.",
  "Cosas que no se pudieron importar": "Things that could not be imported",

  // Errores del archivo
  "Formato de archivo no reconocido. Sube un .pizarro.zip de Pizarro, un JSON exportado de Trello o un CSV.": "File format not recognised. Upload a Pizarro .pizarro.zip, a JSON exported from Trello or a CSV.",
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
    "The CSV has no recognisable title column (título, title, name, summary…). Check the header in the first row.",

  // Textos que se escriben en las tareas
  "Sin nombre": "Unnamed",
  "Alguien": "Someone",
  "Tarea": "Task",
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
  "{n} prioridades no se reconocieron y se han ignorado.": "{n} priorities were not recognised and were ignored.",
  "{n} filas no tenían título y se han ignorado.": "{n} rows had no title and were ignored.",
  "{n} tarjetas no tenían título y se han ignorado.": "{n} cards had no title and were ignored.",
  "{n} etiquetas de tareas sobraban (máximo {max} por tarea) y no se han importado.": "{n} task labels were over the limit ({max} per task) and were not imported.",
  "{n} elementos de checklist sobraban (máximo {max} subtareas por tarea) y no se han importado.": "{n} checklist items were over the limit ({max} subtasks per task) and were not imported.",
  "{n} subtareas sobraban (máximo {max} por tarea) y no se han importado.": "{n} subtasks were over the limit ({max} per task) and were not imported.",
  "{n} comentarios antiguos no se han importado: de cada tarjeta con más de {max} se guardan los {max} más recientes.":
    "{n} older comments were not imported: for each card with more than {max}, the {max} most recent are kept.",
  "{n} etiquetas sobraban (máximo {max} por proyecto) y no se han importado.": "{n} labels were over the limit ({max} per project) and were not imported.",
  "{n} tareas archivadas sobraban (máximo {max}) y no se han importado.": "{n} archived tasks were over the limit ({max}) and were not imported.",
};
