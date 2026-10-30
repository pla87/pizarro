import { TaskItem, TaskList } from "@tiptap/extension-list";
import StarterKit from "@tiptap/starter-kit";

/**
 * Formato del editor con barra (TipTap), sin las menciones: StarterKit (títulos, listas, cita, código, regla, enlace,
 * subrayado…) más listas de tareas («- [ ] x»). Vive aparte para que los tests comprueben la ida y vuelta con Markdown.
 * Tab / Mayús+Tab sangran y desangran los elementos de lista (ListItem y TaskItem); en el primer elemento, que no se puede
 * sangrar, Tab no hace nada especial y el foco sigue su camino.
 */
export function formatExtensions() {
  return [
    // El subrayado ya viene en StarterKit y se serializa como ++texto++.
    StarterKit.configure({ heading: { levels: [2, 3] }, link: { openOnClick: false } }),
    TaskList,
    TaskItem.configure({
      nested: true,
      // Etiqueta de la casilla para lectores de pantalla, en el idioma de la página (por defecto sale en inglés).
      a11y: { checkboxLabel: (node) => `${typeof document !== "undefined" && document.documentElement.lang.startsWith("en") ? "Task" : "Tarea"}: ${node.textContent}` },
    }),
  ];
}
