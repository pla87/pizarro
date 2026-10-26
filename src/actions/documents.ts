"use server";

import { z } from "zod";
import { describeAction } from "@/lib/action-context";
import { runAction } from "@/lib/action";
import { deleteTrashedDocumentRow, renameDocumentRow, restoreDocumentRow, trashDocumentRow } from "@/lib/documents";
import { sanitizeDocumentName } from "@/lib/document-kind";
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
    const clean = sanitizeDocumentName(z.string().max(300).parse(name));
    const before = await renameDocumentRow(user, v.id.parse(documentId), clean);
    describeAction("Renombró un documento a «{name}»", { name: before.name }, { documentId: before.id });
    return { name: clean };
  });
}
