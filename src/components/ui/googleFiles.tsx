"use client";

import { FileSpreadsheet, FileText, Presentation } from "lucide-react";
import type { GoogleFileKind } from "@/lib/google-files";
import { cn } from "./cn";

/**
 * Comandos @docs / @sheets / @slides de los editores (con y sin barra): crean el archivo en Google Drive y lo enlazan a la
 * tarea. `keys`: lo que se puede escribir tras «@» para que aparezca (sin acentos). Las etiquetas se traducen al pintarlas.
 */
export const GOOGLE_COMMANDS: { id: GoogleFileKind; label: string; hint: string; keys: string[] }[] = [
  { id: "GOOGLE_SHEET", label: "Crear Google Sheet", hint: "Hoja de cálculo nueva enlazada a la tarea", keys: ["sheets", "sheet", "hoja", "excel", "google"] },
  { id: "GOOGLE_DOC", label: "Crear Google Doc", hint: "Documento nuevo enlazado a la tarea", keys: ["docs", "doc", "documento", "google"] },
  { id: "GOOGLE_SLIDES", label: "Crear Google Slides", hint: "Presentación nueva enlazada a la tarea", keys: ["slides", "slide", "presentacion", "diapositivas", "powerpoint", "google"] },
];

/** Icono de cada tipo de archivo de Google, con el color de su aplicación. */
export function GoogleFileIcon({ kind, size, className }: { kind: GoogleFileKind; size: number; className?: string }) {
  if (kind === "GOOGLE_SHEET") return <FileSpreadsheet size={size} className={cn("text-emerald-600", className)} />;
  if (kind === "GOOGLE_SLIDES") return <Presentation size={size} className={cn("text-amber-500", className)} />;
  return <FileText size={size} className={cn("text-sky-600", className)} />;
}
