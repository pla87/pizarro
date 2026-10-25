import { createHash } from "node:crypto";

/**
 * Versión del reparto de un ZIP de release: hash de la lista de ficheros (id, tamaño y orden) y del tope en MB.
 * El plan la devuelve y cada paquete la envía de vuelta (`?v=`): si los adjuntos cambian entre una petición y otra,
 * el token ya no coincide y se avisa en lugar de entregar paquetes de repartos distintos.
 */
export function zipPlanToken(files: { id: string; size: number }[], maxMb: number): string {
  const h = createHash("sha256");
  h.update(`limit:${maxMb}`);
  for (const f of files) h.update(`\n${f.id}:${f.size}`);
  return h.digest("hex").slice(0, 16);
}
