// Selección múltiple en el tablero: arrastrar (o mover con Alt+flechas) una tarjeta seleccionada mueve toda la selección.
// Clave: texto exacto en español.
export const seleccion: Record<string, string> = {
  // Lector de pantalla al arrastrar una selección (drag-a11y.ts)
  "Has cogido {n} tarjetas («{title}» y {more} más), en {place}.": "Picked up {n} cards (“{title}” and {more} more), in {place}.",
  "Has cogido {n} tarjetas («{title}» y {more} más).": "Picked up {n} cards (“{title}” and {more} more).",
  "Las {n} tarjetas están sobre {place}.": "The {n} cards are over {place}.",
  "Las {n} tarjetas ya no están sobre ninguna columna.": "The {n} cards are no longer over any column.",
  "Has soltado {n} tarjetas en {place}.": "Dropped {n} cards in {place}.",
  "Has soltado {n} tarjetas fuera de las columnas: no se mueven.": "Dropped {n} cards outside the columns: they stay where they were.",
  "Arrastre cancelado: las {n} tarjetas vuelven a su sitio.": "Drag cancelled: the {n} cards go back to where they were.",
  "Con varias tarjetas seleccionadas, Alt+flechas sobre una de ellas las mueve todas juntas, y al arrastrar una de ellas se arrastran todas.":
    "With several cards selected, Alt+arrows on one of them moves them all together, and dragging one of them drags them all.",

  // Hueco de destino mientras se arrastra una selección (globals.css)
  "{n} tarjetas irán aquí": "{n} cards will go here",

  // Atajos (ShortcutsHelp)
  "Con el foco en una de varias seleccionadas: moverlas todas juntas": "On one of several selected cards: move them all together",
};
