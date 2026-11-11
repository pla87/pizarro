// Caza de bugs (3): subidas a una tarea borrada, espera de Telegram tras cambiar de bot y plurales con un número.
// Clave: texto exacto en español.
export const bh3: Record<string, string> = {
  // Subida de un adjunto a una tarea que se ha borrado mientras llegaba el archivo.
  "La tarea ya no existe.": "The task no longer exists.",
  // Mi perfil → Avisos: se esperaba a «Iniciar» y el administrador cambió el bot (o se pidió otro enlace en otra pestaña).
  "Este enlace ya no vale: el administrador ha cambiado el bot de Telegram o se ha pedido otro enlace. Vuelve a pulsar «Conectar Telegram».":
    "This link is no longer valid: the administrator changed the Telegram bot or another link was requested. Press “Connect Telegram” again.",
  // Avisos de importación con un solo elemento (antes «1 títulos eran…»).
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
  "1 prioridad no se reconoció y se ha ignorado.": "1 priority was not recognised and was ignored.",
  "1 subtarea sobraba (máximo {max} por tarea) y no se ha importado.": "1 subtask was over the limit ({max} per task) and was not imported.",
  "1 etiqueta sobraba (máximo {max} por proyecto) y no se ha importado.": "1 label was over the limit ({max} per project) and was not imported.",
  "1 tarea archivada sobraba (máximo {max}) y no se ha importado.": "1 archived task was over the limit ({max}) and was not imported.",
  // Contadores y avisos de la interfaz con 1.
  "1 aviso sin leer": "1 unread notification",
  "1 código de recuperación sin usar": "1 unused recovery code",
  "1 subtarea añadida": "1 subtask added",
  "Se añadió 1 subtarea; 1 no cabe (máximo {max} por tarea).": "Added 1 subtask; 1 doesn't fit (maximum {max} per task).",
  "Se añadió 1 subtarea; {m} no caben (máximo {max} por tarea).": "Added 1 subtask; {m} don't fit (maximum {max} per task).",
  "Se añadieron {n} subtareas; 1 no cabe (máximo {max} por tarea).": "Added {n} subtasks; 1 doesn't fit (maximum {max} per task).",
  "1 tarjeta": "1 card",
  "¿Borrar el adjunto de esta release? El texto se conserva.": "Delete this release's attachment? The text is kept.",
  "+1 entregable más": "+1 more deliverable",
  "+1 tarea con rango más": "+1 more ranged task",
  "1 nuevo": "1 new",
  "1 fichero nuevo": "1 new file",
  "1 ya estaba": "1 already there",
  "Filtros (1 activo)": "Filters (1 active)",
  "Puso un límite de 1 tarjeta a la columna «{name}»": "Set a limit of 1 card on the column “{name}”",
};
