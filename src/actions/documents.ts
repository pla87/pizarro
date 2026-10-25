"use server";

import { z } from "zod";
import { describeAction } from "@/lib/action-context";
import { runAction } from "@/lib/action";
import { deleteDocumentRow, renameDocumentRow } from "@/lib/documents";
import { sanitizeDocumentName } from "@/lib/document-kind";
import { requireUser } from "@/lib/session";
import { removeDocumentFiles } from "@/lib/uploads";
import * as v from "@/lib/validation";

/** Borra un documento de la documentación del proyecto (fila y fichero). Sin deshacer: el cliente pide confirmación. */
export async function deleteDocument(documentId: string) {
  return runAction({ name: "documents.deleteDocument", args: [documentId] }, async () => {
    const user = await requireUser();
    const doc = await deleteDocumentRow(user, v.id.parse(documentId));
    await removeDocumentFiles([doc.id]);
    describeAction("Borró el documento «{name}»", { name: doc.name }, { documentId: doc.id, size: doc.size, kind: doc.kind });
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
