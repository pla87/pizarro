"use client";

import { createGoogleFile } from "@/actions/tasks";
import { makeT, type T } from "@/i18n/core";
import type { TaskLinkInfo } from "@/lib/types";

/**
 * Crea un Google Doc/Sheet y lo abre en una pestaña nueva. La pestaña se abre de forma
 * síncrona (dentro del clic o la tecla) para que el navegador no la bloquee, y se
 * redirige al documento cuando Google responde.
 */
export async function createAndOpenGoogleFile(
  taskId: string,
  kind: "GOOGLE_DOC" | "GOOGLE_SHEET",
  title: string,
  t: T = makeT("es"),
): Promise<{ ok: true; link: TaskLinkInfo } | { ok: false; error: string }> {
  const win = window.open("about:blank", "_blank");
  if (win) {
    win.document.title = t("Creando documento…");
    // Nodos DOM con textContent (nunca innerHTML): el texto no se interpreta como HTML.
    const p = win.document.createElement("p");
    p.style.cssText = "font-family:system-ui;padding:2rem;color:#475569";
    p.textContent = t("Creando el documento en Google Drive…");
    win.document.body.replaceChildren(p);
  }
  let res: Awaited<ReturnType<typeof createGoogleFile>>;
  try {
    res = await createGoogleFile(taskId, kind, title);
  } catch (err) {
    // Sin red o acción de una versión anterior: no se deja la pestaña en blanco abierta.
    win?.close();
    throw err;
  }
  if (!res.ok) {
    win?.close();
    return res;
  }
  if (win) {
    win.opener = null;
    win.location.href = res.data.url;
  }
  return { ok: true, link: res.data };
}

/**
 * Aviso cuando el documento se creó pero no se compartió como estaba previsto (null si todo fue bien o no consta).
 * Va en el aviso al crearlo y en el icono de la lista de documentos de la tarea.
 */
export function shareWarning(link: Pick<TaskLinkInfo, "shareStatus" | "shareFailed">, t: T): string | null {
  if (link.shareStatus === "NOT_SHARED") return t("Documento creado, pero no se ha compartido: solo lo ves tú");
  if (link.shareStatus === "PARTIAL" && link.shareFailed === 1) return t("Documento creado, pero no se pudo compartir con 1 persona");
  if (link.shareStatus === "PARTIAL") return t("Documento creado, pero no se pudo compartir con {n} personas", { n: link.shareFailed });
  return null;
}
