// Nombres accesibles de los botones repetidos en listas (dicen a qué elemento afectan).
// Clave: texto exacto en español.
export const accesibilidad: Record<string, string> = {
  "Subir la columna {n}": "Move column {n} up",
  "Bajar la columna {n}": "Move column {n} down",
  "Quitar la columna {n}": "Remove column {n}",
  "Subir el tipo {n}": "Move type {n} up",
  "Bajar el tipo {n}": "Move type {n} down",
  "Quitar el tipo {n}": "Remove type {n}",
  "Subir la plantilla de release {n}": "Move release template {n} up",
  "Bajar la plantilla de release {n}": "Move release template {n} down",
  "Quitar la plantilla de release {n}": "Remove release template {n}",
  "Quitar la etiqueta {n}": "Remove label {n}",
  "Descartar «{name}»": "Dismiss “{name}”",
  "Restaurar «{name}»": "Restore “{name}”",
  "Borrar definitivamente «{name}»": "Delete “{name}” permanently",
  "Abrir «{name}»": "Open “{name}”",
  "Quitar «{name}» de mis proyectos": "Remove “{name}” from my projects",
  "Añadir «{name}» a mis proyectos": "Add “{name}” to my projects",
  "Quitar la subtarea «{name}»": "Remove subtask “{name}”",
  "Quitar «{name}»": "Remove “{name}”",

  // Tarjeta del tablero: descripción para el lector de pantalla («Saltar al contenido» ya está en web.ts)
  "Subtareas: {done} de {total}": "Subtasks: {done} of {total}",

  // Arrastrar y soltar: avisos del lector de pantalla (drag-a11y.ts, prop `accessibility` de los DndContext)
  "ordenable": "sortable",
  "arrastrable": "draggable",
  "las tareas fijas de {column}": "the pinned tasks of {column}",
  "la columna {column}": "the {column} column",
  "Has cogido «{title}».": "Picked up “{title}”.",
  "Has cogido «{title}», en {place}.": "Picked up “{title}”, in {place}.",
  "«{title}» está sobre {place}.": "“{title}” is over {place}.",
  "«{title}» ya no está sobre ninguna columna.": "“{title}” is no longer over a column.",
  "Has soltado «{title}» en {place}.": "Dropped “{title}” in {place}.",
  "Has soltado «{title}» fuera de las columnas: no se mueve.": "Dropped “{title}” outside the columns: it stays where it was.",
  "Arrastre cancelado: «{title}» vuelve a su sitio.": "Drag cancelled: “{title}” goes back to where it was.",
  "Para mover una tarjeta con el teclado, pon el foco en ella: Alt+flecha izquierda o derecha la pasa a la columna anterior o siguiente, y Alt+flecha arriba o abajo la sube o la baja en su columna. Una tarea fija de la release se saca del panel desde su detalle (Columna o Fija en la release).":
    "To move a card with the keyboard, focus it: Alt+Left or Right arrow moves it to the previous or next column, and Alt+Up or Down arrow moves it up or down in its column. A pinned release task is taken out of the panel from its details (Column or Pinned to the release).",
  "Has cogido la subtarea «{title}», en la posición {n} de {total}.": "Picked up subtask “{title}”, at position {n} of {total}.",
  "Has cogido la subtarea «{title}».": "Picked up subtask “{title}”.",
  "«{title}» pasa a la posición {n} de {total}.": "“{title}” moves to position {n} of {total}.",
  "«{title}» ya no está sobre la lista.": "“{title}” is no longer over the list.",
  "Has soltado «{title}» en la posición {n} de {total}.": "Dropped “{title}” at position {n} of {total}.",
  "Has soltado «{title}» fuera de la lista: no se mueve.": "Dropped “{title}” outside the list: it stays where it was.",
  "Para reordenar la subtarea con el teclado, pulsa Espacio o Enter para cogerla, muévela con las flechas arriba y abajo, y pulsa Espacio o Enter para soltarla. Escape cancela.":
    "To reorder the subtask with the keyboard, press Space or Enter to pick it up, move it with the Up and Down arrow keys, and press Space or Enter to drop it. Escape cancels.",
};
