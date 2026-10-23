"use client";

import { useT } from "@/i18n/client";
import { Modal } from "../ui/Modal";
import { shortcutLabel } from "./shortcuts";

/** Atajos en notación Windows/Linux; la columna de Mac se deriva (Ctrl→⌘, Alt→⌥, Shift→⇧). */
const GROUPS: { title: string; items: { keys: string; label: string }[] }[] = [
  {
    title: "Tablero",
    items: [
      { keys: "Alt+N", label: "Nueva tarea (con una tarea abierta, otra al lado)" },
      { keys: "Alt+Shift+N", label: "Varias tareas" },
      { keys: "/", label: "Filtrar tarjetas" },
      { keys: "Alt+P", label: "Cambiar de proyecto" },
      { keys: "Alt+R", label: "Generar Release" },
      { keys: "Alt+Z", label: "Deshacer en el tablero (también con una tarea abierta)" },
      { keys: "Ctrl+Z", label: "Deshacer (en una tarea abierta, solo sus cambios)" },
      { keys: "Alt+Shift+Z", label: "Rehacer en el tablero (también con una tarea abierta)" },
      { keys: "Ctrl+Shift+Z", label: "Rehacer (en una tarea abierta, solo sus cambios; también Ctrl+Y)" },
      { keys: "Ctrl+V", label: "Pegar una captura como nueva tarea" },
      { keys: "?", label: "Ver los atajos" },
    ],
  },
  {
    title: "Tarjeta enfocada",
    items: [
      { keys: "Alt+M", label: "Asignármela o quitármela" },
      { keys: "Alt+←", label: "Mover a la columna anterior" },
      { keys: "Alt+→", label: "Mover a la columna siguiente" },
      { keys: "Alt+D", label: "Fecha límite de la tarjeta" },
      { keys: "F2", label: "Renombrar la tarjeta" },
      { keys: "Alt+Shift+D", label: "Duplicar la tarjeta" },
    ],
  },
  {
    title: "Tarea abierta",
    items: [
      { keys: "Alt+S", label: "Guardar y cerrar (en una tarea nueva, crearla)" },
      { keys: "Alt+A", label: "Archivar la tarea" },
      { keys: "Ctrl+Enter", label: "Crear la tarea, guardar la descripción o enviar el comentario" },
      { keys: "Alt+F10", label: "Ir a la barra de formato de la descripción (flechas para moverse, Esc para volver)" },
      { keys: "Esc", label: "Cerrar" },
    ],
  },
];

export function ShortcutsHelp({ onClose }: { onClose: () => void }) {
  const t = useT();
  return (
    <Modal open onClose={onClose} title={t("Atajos de teclado")} size="md">
      <div className="space-y-5">
        {GROUPS.map((g) => (
          <section key={g.title}>
            <div className="mb-1 grid grid-cols-[1fr_7rem_5rem] items-center gap-x-3 text-xs font-medium text-slate-500">
              <h3>{t(g.title)}</h3>
              <span>Windows / Linux</span>
              <span>Mac</span>
            </div>
            <ul className="divide-y divide-slate-100 dark:divide-slate-800">
              {g.items.map((it) => (
                <li key={it.keys + it.label} className="grid grid-cols-[1fr_7rem_5rem] items-center gap-x-3 py-1.5 text-sm">
                  <span>{t(it.label)}</span>
                  <Keys>{it.keys}</Keys>
                  <Keys>{shortcutLabel(it.keys, true)}</Keys>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </Modal>
  );
}

function Keys({ children }: { children: string }) {
  return (
    <kbd className="w-fit rounded border border-slate-300 bg-slate-50 px-1.5 py-0.5 font-sans text-xs text-slate-700 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200">
      {children}
    </kbd>
  );
}
