"use server";

import { z } from "zod";
import { describeAction } from "@/lib/action-context";
import { runAction } from "@/lib/action";
import { assertProjectAccess } from "@/lib/access";
import { createNoteRow, deleteTrashedDocumentRow, discardEmptyNoteRow, getNoteForUser, renameDocumentRow, restoreDocumentRow, saveNoteRow, searchNoteIds, setDocumentPinnedRow, trashDocumentRow } from "@/lib/documents";
import { NOTE_MAX_CHARS, sanitizeDocumentName } from "@/lib/document-kind";
import { getT } from "@/i18n/server";
import { requireUser } from "@/lib/session";
import * as v from "@/lib/validation";

/** Envía un documento a la papelera (se conserva 7 días y se puede restaurar). El fichero no se toca hasta la purga. */
export async function deleteDocument(documentId: string) {
  return runAction({ name: "documents.deleteDocument", args: [documentId] }, async () => {
    const user = await requireUser();
    const doc = await trashDocumentRow(user, v.id.parse(documentId));
    describeAction("Envió el documento «{name}» a la papelera", { name: doc.name }, { documentId: doc.id, size: doc.size, kind: doc.kind });
  });
}

/** Saca un documento de la papelera (vuelve a comprobar el máximo de documentos y la cuota). */
export async function restoreDocument(documentId: string) {
  return runAction({ name: "documents.restoreDocument", args: [documentId] }, async () => {
    const user = await requireUser();
    const doc = await restoreDocumentRow(user, v.id.parse(documentId));
    describeAction("Restauró el documento «{name}» de la papelera", { name: doc.name }, { documentId: doc.id, size: doc.size, kind: doc.kind });
  });
}

/** Borra para siempre un documento de la papelera (fila y fichero). El cliente pide confirmación. */
export async function deleteDocumentForever(documentId: string) {
  return runAction({ name: "documents.deleteDocumentForever", args: [documentId] }, async () => {
    const user = await requireUser();
    const doc = await deleteTrashedDocumentRow(user, v.id.parse(documentId));
    describeAction("Borró definitivamente el documento «{name}»", { name: doc.name }, { documentId: doc.id, size: doc.size, kind: doc.kind });
  });
}

/** Cambia el nombre mostrado de un documento (el tipo y el fichero no cambian). */
export async function renameDocument(documentId: string, name: string) {
  return runAction({ name: "documents.renameDocument", args: [documentId, name] }, async () => {
    const user = await requireUser();
    // Sin el nombre por defecto: un nombre que se queda vacío al sanearlo («   », «...») es un error
    // («El nombre no puede estar vacío.», renameDocumentRow), no «documento» sin avisar.
    const clean = sanitizeDocumentName(z.string().max(300).parse(name), "");
    const before = await renameDocumentRow(user, v.id.parse(documentId), clean);
    describeAction("Renombró un documento a «{name}»", { name: before.name }, { documentId: before.id });
    return { name: clean };
  });
}

// --- Notas escritas en la app y documentos fijados -----------------------------------------------------------------

/** Crea una nota vacía («Nota sin título») en la Documentación del proyecto, con los mismos límites que una subida. */
export async function createNote(projectId: string) {
  return runAction({ name: "documents.createNote", args: [projectId] }, async () => {
    const user = await requireUser();
    const id = v.id.parse(projectId);
    await assertProjectAccess(user, id);
    const t = await getT();
    const doc = await createNoteRow(user, id, t("Nota sin título"));
    describeAction("Creó la nota «{name}»", { name: doc.name }, { documentId: doc.id });
    return doc;
  });
}

/**
 * Descarta la nota que acaba de crearse con «Nueva nota» si se cierra sin haber escrito nada (no deja una «Nota sin
 * título» vacía en la lista). Solo borra una nota vacía, sin guardar nunca, sin renombrar ni fijar y creada por esta
 * persona; en cualquier otro caso no hace nada (`discarded: false`).
 */
export async function discardEmptyNote(documentId: string) {
  return runAction({ name: "documents.discardEmptyNote", args: [documentId] }, async () => {
    const user = await requireUser();
    const gone = await discardEmptyNoteRow(user, v.id.parse(documentId));
    if (gone) describeAction("Descartó la nota vacía «{name}»", { name: gone.name }, { documentId: gone.id });
    return { discarded: !!gone };
  });
}

/** Texto y versión de una nota (para abrirla en el visor o en el editor). */
export async function getNote(documentId: string) {
  return runAction({ name: "documents.getNote", args: [documentId] }, async () => {
    const user = await requireUser();
    const note = await getNoteForUser(user, v.id.parse(documentId));
    return { content: note.content, version: note.version, trashed: note.trashed };
  });
}

/**
 * Guarda el texto de una nota (guardado automático del editor). `baseVersion`: la versión que conocía el editor; si
 * otra persona la cambió entretanto no se guarda y vuelve su versión (`status: "conflict"`). Cuando sale bien no deja
 * rastro en Logs (se guarda cada pocos segundos mientras se escribe) ni avisa a las pestañas del tablero.
 */
export async function saveNote(documentId: string, content: string, baseVersion: number) {
  // En el registro, solo el tamaño del texto (no el texto entero en cada fallo).
  return runAction({ name: "documents.saveNote", args: [documentId, `${String(content).length}`, baseVersion] }, async () => {
    const user = await requireUser();
    // El tope de caracteres lo da saveNoteRow con su propio mensaje; aquí solo se corta lo desmesurado.
    const text = z.string().max(NOTE_MAX_CHARS * 2).parse(content);
    return saveNoteRow(user, v.id.parse(documentId), text, z.number().int().min(0).parse(baseVersion));
  });
}

/** Fija un documento arriba en la lista de Documentación («Notas generales») o lo quita de ahí. */
export async function setDocumentPinned(documentId: string, pinned: boolean) {
  return runAction({ name: "documents.setDocumentPinned", args: [documentId, pinned] }, async () => {
    const user = await requireUser();
    const on = z.boolean().parse(pinned);
    const doc = await setDocumentPinnedRow(user, v.id.parse(documentId), on);
    if (on) describeAction("Fijó «{name}» arriba en Documentación", { name: doc.name }, { documentId: doc.id });
    else describeAction("Quitó «{name}» de los fijados de Documentación", { name: doc.name }, { documentId: doc.id });
  });
}

/** Ids de las notas del proyecto cuyo texto contiene `q` (el nombre ya lo filtra el navegador). */
export async function searchNotes(projectId: string, q: string) {
  return runAction({ name: "documents.searchNotes", args: [projectId, q] }, async () => {
    const user = await requireUser();
    const id = v.id.parse(projectId);
    await assertProjectAccess(user, id);
    return searchNoteIds(id, z.string().max(200).parse(q));
  });
}
