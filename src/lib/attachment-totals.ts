import type { AttachmentInfo, AttachmentTotals } from "./types";

/** Contadores de la tarjeta calculados sobre la lista de adjuntos que se muestra (valor absoluto, nunca una suma acumulada). */
export function attachmentTotalsOf(list: Pick<AttachmentInfo, "isImage" | "size">[]): AttachmentTotals {
  let imageCount = 0, fileCount = 0, attachBytes = 0;
  for (const a of list) {
    if (a.isImage) imageCount++;
    else fileCount++;
    attachBytes += a.size;
  }
  return { imageCount, fileCount, attachBytes };
}
