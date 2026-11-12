// Traducciones al inglés (detalle de la tarea: adjuntos, subtareas, cerrar con cambios, texto cambiado desde otra pestaña y
// tarea que otra persona borra o archiva mientras está abierta). Clave: texto exacto en español.
export const detalle: Record<string, string> = {
  // Adjuntos
  "Capturas y adjuntos ({n})": "Screenshots and attachments ({n})",
  // Subtareas pegadas con varias líneas
  "{n} subtareas añadidas": "{n} subtasks added",
  "Se añadieron {n} subtareas; {m} no caben (máximo {max} por tarea).": "Added {n} subtasks; {m} don't fit (maximum {max} per task).",
  "Añadió {subs} en «{task}»": "Added {subs} in “{task}”",
  // Cerrar el detalle con cambios sin guardar
  "La descripción tiene cambios sin guardar. ¿Cerrar la tarea y descartarlos?": "The description has unsaved changes. Close the task and discard them?",
  "Hay una subtarea a medio escribir. ¿Cerrar la tarea y descartarla?": "There is a half-written subtask. Close the task and discard it?",
  "La descripción tiene cambios sin guardar y hay una subtarea a medio escribir. ¿Cerrar la tarea y descartarlos?":
    "The description has unsaved changes and there is a half-written subtask. Close the task and discard them?",
  "¿Descartar los cambios de la descripción?": "Discard the changes to the description?",

  // Texto de la tarea cambiado desde otra pestaña o dispositivo de la misma persona mientras se editaba
  "Has cambiado el texto de esta tarea en otra pestaña u otro dispositivo mientras la editabas aquí. Se ha recargado con ese texto: vuelve a aplicar tus cambios.":
    "You changed the text of this task in another tab or device while you were editing it here. It has been reloaded with that text: apply your changes again.",

  // Subida de un adjunto a una tarea que se ha borrado mientras llegaba el archivo
  "La tarea ya no existe.": "The task no longer exists.",

  // Subtareas añadidas: textos con 1
  "1 subtarea añadida": "1 subtask added",
  "Se añadió 1 subtarea; 1 no cabe (máximo {max} por tarea).": "Added 1 subtask; 1 doesn't fit (maximum {max} per task).",
  "Se añadió 1 subtarea; {m} no caben (máximo {max} por tarea).": "Added 1 subtask; {m} don't fit (maximum {max} per task).",
  "Se añadieron {n} subtareas; 1 no cabe (máximo {max} por tarea).": "Added {n} subtasks; 1 doesn't fit (maximum {max} per task).",

  // Título o enlace que no se pudieron guardar al cerrar el detalle
  "No se ha podido guardar el título o el enlace. ¿Cerrar la tarea y descartarlo?": "The title or link could not be saved. Close the task and discard it?",

  // La tarea abierta desaparece (otra persona la borró o archivó)
  "Esta tarea ya no está en el tablero: la han borrado o archivado": "This task is no longer on the board: it was deleted or archived",
  "Has borrado esta tarea desde otra pestaña": "You deleted this task in another tab",
  "Has archivado esta tarea desde otra pestaña": "You archived this task in another tab",
  "{name} ha borrado esta tarea": "{name} deleted this task",
  "{name} ha archivado esta tarea": "{name} archived this task",
  "Han borrado esta tarea": "This task was deleted",
  "Han archivado esta tarea": "This task was archived",

  // Cerrar el detalle con varios cambios a medias o un comentario en edición
  "Hay varios cambios sin guardar (descripción, subtareas o un comentario en edición). ¿Cerrar la tarea y descartarlos?": "There are several unsaved changes (description, subtasks or a comment being edited). Close the task and discard them?",
  "Estás editando un comentario y tiene cambios sin guardar. ¿Cerrar la tarea y descartarlos?": "You are editing a comment with unsaved changes. Close the task and discard them?",
};
