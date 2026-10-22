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
    win.document.body.innerHTML = `<p style="font-family:system-ui;padding:2rem;color:#475569">${t("Creando el documento en Google Drive…")}</p>`;
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
