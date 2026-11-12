// Caza de bugs (48b): sin conexión, tarea abierta que desaparece, enlaces ?task= y columna borrada en «Nueva tarea».
// Clave: texto exacto en español.
export const bh48b: Record<string, string> = {
  // Sin conexión (lib/connection.ts, ConnectionNotice).
  "Sin conexión: no se ha guardado": "Offline: not saved",
  "Sin conexión. Lo que cambies no se guardará hasta que vuelva.": "Offline. Your changes won't be saved until the connection is back.",
  "Conexión recuperada": "Connection restored",
  // Título o enlace que no se pudieron guardar al cerrar el detalle.
  "No se ha podido guardar el título o el enlace. ¿Cerrar la tarea y descartarlo?": "The title or link could not be saved. Close the task and discard it?",
  // La tarea abierta desaparece (otra persona la borró o archivó).
  "Esta tarea ya no está en el tablero: la han borrado o archivado": "This task is no longer on the board: it was deleted or archived",
  "Has borrado esta tarea desde otra pestaña": "You deleted this task in another tab",
  "Has archivado esta tarea desde otra pestaña": "You archived this task in another tab",
  "{name} ha borrado esta tarea": "{name} deleted this task",
  "{name} ha archivado esta tarea": "{name} archived this task",
  "Han borrado esta tarea": "This task was deleted",
  "Han archivado esta tarea": "This task was archived",
  // Enlace ?task= a una tarea que no está en el tablero.
  "La tarea no existe, está archivada o no tienes acceso": "The task doesn't exist, is archived or you don't have access",
  // «Nueva tarea» con una columna que otra persona borró.
  "La columna elegida ya no existe. La tarea se creará en «{name}».": "The chosen column no longer exists. The task will be created in “{name}”.",
};
