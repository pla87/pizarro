import type { Announcements, DndContextProps } from "@dnd-kit/core";
import type { T } from "@/i18n/shared";

/**
 * Textos del lector de pantalla al arrastrar (prop `accessibility` de los DndContext). Sin esto dnd-kit los da en inglés
 * y con el id interno («Picked up draggable item cmwe…»); aquí dicen el título y dónde queda.
 */
type Accessibility = NonNullable<DndContextProps["accessibility"]>;

/**
 * Último sitio anunciado del arrastre en curso (solo hay uno a la vez en la página). dnd-kit avisa de «sobre…» justo
 * después de coger, sobre el mismo sitio, y cada vez que pasa por otra tarjeta: sin esto el lector de pantalla no llegaba
 * a decir «Has cogido…» y repetía la misma columna. Se guarda aquí porque los avisos se crean en cada render.
 */
let lastPlace: string | null = null;

/**
 * Tablero. Las tarjetas se mueven con el teclado con Alt+flechas (TaskCard): no se «cogen» como en dnd-kit (su
 * KeyboardSensor no llega a arrancar: ni en las tarjetas ni en las tareas fijas, cuyo onKeyDown sustituye al suyo).
 * `where(id)` dice dónde está un elemento: el nombre de la columna (de una tarjeta o de la propia columna) o `null`.
 */
export function boardDragA11y(t: T, titleOf: (id: string) => string, where: (id: string) => { column: string } | { evergreen: string } | null): Accessibility {
  const place = (id: string) => {
    const at = where(id);
    if (!at) return null;
    return "evergreen" in at ? t("las tareas fijas de {column}", { column: at.evergreen }) : t("la columna {column}", { column: at.column });
  };
  const announcements: Announcements = {
    onDragStart: ({ active }) => {
      const title = titleOf(String(active.id));
      lastPlace = place(String(active.id));
      return lastPlace ? t("Has cogido «{title}», en {place}.", { title, place: lastPlace }) : t("Has cogido «{title}».", { title });
    },
    onDragOver: ({ active, over }) => {
      const title = titleOf(String(active.id));
      const at = over ? place(String(over.id)) : null;
      if (at === lastPlace) return undefined;
      lastPlace = at;
      return at ? t("«{title}» está sobre {place}.", { title, place: at }) : t("«{title}» ya no está sobre ninguna columna.", { title });
    },
    onDragEnd: ({ active, over }) => {
      const title = titleOf(String(active.id));
      const at = over ? place(String(over.id)) : null;
      return at ? t("Has soltado «{title}» en {place}.", { title, place: at }) : t("Has soltado «{title}» fuera de las columnas: no se mueve.", { title });
    },
    onDragCancel: ({ active }) => t("Arrastre cancelado: «{title}» vuelve a su sitio.", { title: titleOf(String(active.id)) }),
  };
  return {
    announcements,
    screenReaderInstructions: {
      draggable: t(
        "Para mover una tarjeta con el teclado, pon el foco en ella: Alt+flecha izquierda o derecha la pasa a la columna anterior o siguiente, y Alt+flecha arriba o abajo la sube o la baja en su columna. Una tarea fija de la release se saca del panel desde su detalle (Columna o Fija en la release).",
      ),
    },
  };
}

/** Subtareas del detalle: se reordenan desde su asa de seis puntos (Espacio o Enter, flechas, Espacio o Enter, Escape). */
export function subtaskDragA11y(t: T, titleOf: (id: string) => string, positionOf: (id: string) => { n: number; total: number } | null): Accessibility {
  const announcements: Announcements = {
    onDragStart: ({ active }) => {
      const title = titleOf(String(active.id));
      const at = positionOf(String(active.id));
      lastPlace = at ? String(at.n) : null;
      return at ? t("Has cogido la subtarea «{title}», en la posición {n} de {total}.", { title, ...at }) : t("Has cogido la subtarea «{title}».", { title });
    },
    onDragOver: ({ active, over }) => {
      const title = titleOf(String(active.id));
      const at = over ? positionOf(String(over.id)) : null;
      const key = at ? String(at.n) : null;
      if (key === lastPlace) return undefined;
      lastPlace = key;
      return at ? t("«{title}» pasa a la posición {n} de {total}.", { title, ...at }) : t("«{title}» ya no está sobre la lista.", { title });
    },
    onDragEnd: ({ active, over }) => {
      const title = titleOf(String(active.id));
      const at = over ? positionOf(String(over.id)) : null;
      return at ? t("Has soltado «{title}» en la posición {n} de {total}.", { title, ...at }) : t("Has soltado «{title}» fuera de la lista: no se mueve.", { title });
    },
    onDragCancel: ({ active }) => t("Arrastre cancelado: «{title}» vuelve a su sitio.", { title: titleOf(String(active.id)) }),
  };
  return {
    announcements,
    screenReaderInstructions: {
      draggable: t("Para reordenar la subtarea con el teclado, pulsa Espacio o Enter para cogerla, muévela con las flechas arriba y abajo, y pulsa Espacio o Enter para soltarla. Escape cancela."),
    },
  };
}
