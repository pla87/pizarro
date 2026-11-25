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

  // «Descartar cambios» del detalle (antes «Cancelar»): pide confirmación si hay cambios tuyos
  "¿Deshacer todos los cambios?": "Undo all the changes?",
  "Deshacer todo": "Undo all",
  "Se desharán los cambios que has hecho en esta tarea desde que la abriste, también lo escrito sin guardar, y se cerrará. Los comentarios y lo que hayan cambiado otras personas se quedan como están.": "The changes you have made to this task since you opened it, including anything typed and not yet saved, will be undone and the task will close. Comments and changes made by other people stay as they are.",

  // Cambiar de tipo con la descripción abierta (ronda 62): el tipo se guarda; la descripción, al pulsar Guardar
  "Tipo guardado; la descripción, sin guardar": "Type saved; description not saved yet",

  // Botón de la descripción en edición (el pie tiene otro «Guardar») y aviso tras cambiar de tipo con ella abierta
  "Guardar descripción": "Save description",
  "Tipo cambiado; falta guardar la descripción": "Type changed; description not saved yet",

  // (Ronda 66) Cambiar de tipo en el detalle: aviso con lo que ha cambiado además del tipo (kindChangeNotice)
  "Tipo cambiado: {changes}": "Type changed: {changes}",
  "1 subtarea quitada": "1 subtask removed",
  "{n} subtareas quitadas": "{n} subtasks removed",
  "1 quitada": "1 removed",
  "{n} quitadas": "{n} removed",
  "plantilla de la descripción aplicada": "description template applied",
  "Tipo cambiado y plantilla aplicada; falta guardar la descripción": "Type changed and template applied; description not saved yet",

  // (Ronda 66) Historial y deshacer del cambio de tipo
  "Cambió el tipo de «{title}» a «{kind}»": "Changed the type of “{title}” to “{kind}”",
  "Quitó las subtareas del tipo anterior: {removed}": "Removed the previous type's subtasks: {removed}",
  "Añadió las subtareas del tipo: {added}": "Added the type's subtasks: {added}",
  "Cambió las subtareas del tipo: quitó {removed}; añadió {added}": "Changed the type's subtasks: removed {removed}; added {added}",
  "Deshecho el cambio de tipo de «{title}»": "Undid the type change of “{title}”",
  "Rehecho el cambio de tipo de «{title}»": "Redid the type change of “{title}”",
  "Deshecho el cambio de {changes} en «{title}»": "Undid changes to {changes} in “{title}”",
  "Rehecho el cambio de {changes} en «{title}»": "Redid changes to {changes} in “{title}”",
  "{text} (parte ya no existía)": "{text} (part of it no longer existed)",

  // (Ronda 66) «Varias tareas»: el tipo común cuando alguna línea tiene otro
  "(ahora hay varios)": "(currently mixed)",

  // (Ronda 66) «Bloquea a» y volver a la tarea de la que se vino
  "Bloquea a": "Blocks",
  "Abrir la tarea bloqueada": "Open the blocked task",
  "Volver a «{title}»": "Back to “{title}”",

  // (Ronda 68) Cambiar de tipo: la plantilla del anterior se quita y el nuevo no tiene (kindChangeNotice)
  "plantilla de la descripción quitada": "description template removed",
  "Tipo cambiado y plantilla quitada; falta guardar la descripción": "Type changed and template removed; description not saved yet",

  // (Ronda 68) Descripción en edición cuando otra persona la cambia (o tras un conflicto): lo escrito no se pierde
  "Otra persona ha cambiado la descripción mientras escribías; lo tuyo sigue aquí, sin guardar": "Someone else changed the description while you were typing; your text is still here, unsaved",
};
