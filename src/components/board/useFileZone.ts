import { useEffect, useState } from "react";
import { filesFrom, hasFiles } from "./upload";

/**
 * Zona del tablero que acepta archivos soltados desde fuera (escritorio) para crear una tarea.
 * Eventos de arrastre nativos, aparte de dnd-kit. Las tarjetas con su propio destino de archivos
 * (useCardFileDrop) detienen el evento antes de llegar aquí; de lo demás, solo cuenta el elemento [data-file-zone].
 */
export function useFileZone(onFiles: (files: File[]) => void) {
  const [over, setOver] = useState(false);

  // Un arrastre que termina fuera de la zona (o se cancela) no debe dejarla resaltada.
  useEffect(() => {
    if (!over) return;
    const reset = () => setOver(false);
    document.addEventListener("dragend", reset);
    document.addEventListener("drop", reset);
    return () => {
      document.removeEventListener("dragend", reset);
      document.removeEventListener("drop", reset);
    };
  }, [over]);

  // Solo cuenta el hueco marcado con data-file-zone (el espacio libre bajo las tarjetas): los huecos entre tarjetas
  // no crean nada. Aun así se cancela el evento para que el navegador no abra el archivo.
  const inZone = (e: React.DragEvent) => !!(e.target as HTMLElement).closest?.("[data-file-zone]");

  const handlers = {
    // En captura: sobre una tarjeta el destino es la tarjeta, no la zona.
    onDragOverCapture: (e: React.DragEvent) => {
      if (!hasFiles(e)) return;
      if ((e.target as HTMLElement).closest?.("[data-task-card], [data-file-target]")) setOver(false);
    },
    onDragOver: (e: React.DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault(); // necesario para que el navegador admita el drop (y no abra el archivo)
      if (!inZone(e)) {
        e.dataTransfer.dropEffect = "none";
        setOver(false);
        return;
      }
      e.dataTransfer.dropEffect = "copy";
      setOver(true);
    },
    onDragLeave: (e: React.DragEvent) => {
      if (!hasFiles(e)) return;
      // Pasar a un hijo no es salir de la zona.
      if (e.relatedTarget instanceof Node && e.currentTarget.contains(e.relatedTarget)) return;
      setOver(false);
    },
    onDrop: (e: React.DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      setOver(false);
      if (!inZone(e)) return;
      const files = filesFrom(e.dataTransfer.files);
      if (files.length) onFiles(files);
    },
  };
  return { over, handlers };
}
