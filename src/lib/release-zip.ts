import "server-only";
import { buildZip } from "./zip";
import { planPackages, zipEntryOverhead, type ZipPackage } from "./zip-plan";

/** Un fichero que puede ir en un ZIP de release: su tamaño ya está comprobado en disco. */
export interface ZipEntry {
  name: string;
  size: number;
  read: () => Promise<Uint8Array>;
}

/** Reparto de las entradas en paquetes de como mucho `maxMb` MB (un fichero mayor va solo y marcado). */
export function planZipEntries(entries: ZipEntry[], maxMb: number): ZipPackage[] {
  return planPackages(
    entries.map((e, index) => ({ index, size: e.size + zipEntryOverhead(e.name) })),
    maxMb * 1024 * 1024,
  );
}

/** Cuerpo JSON del modo «plan»: cuántos paquetes hay y qué pesa cada uno. */
export function zipPlanBody(packages: ZipPackage[], maxMb: number) {
  return { maxMb, parts: packages.map((p) => ({ files: p.items.length, bytes: p.bytes, oversize: p.oversize })) };
}

/** Arma en memoria solo un paquete (nunca más que el tope, salvo un fichero suelto mayor). Los ficheros que ya no están se omiten. */
export async function buildZipPart(entries: ZipEntry[], pkg: ZipPackage): Promise<{ zip: Buffer; files: number }> {
  const files: { name: string; data: Uint8Array }[] = [];
  for (const i of pkg.items) {
    const e = entries[i]!;
    try {
      files.push({ name: e.name, data: await e.read() });
    } catch {
      // Fichero ausente en disco: se omite en lugar de romper toda la descarga.
    }
  }
  return { zip: files.length ? buildZip(files) : Buffer.alloc(0), files: files.length };
}

export type ZipRequestMode = { kind: "plan" } | { kind: "part"; part: number; explicit: boolean };

/** `?plan=1` pide el reparto; `?part=N` (1-based) un paquete; sin nada, el primero. */
export function zipRequestMode(url: string): ZipRequestMode | null {
  const sp = new URL(url).searchParams;
  if (sp.get("plan") === "1") return { kind: "plan" };
  const raw = sp.get("part");
  if (raw === null) return { kind: "part", part: 1, explicit: false };
  const part = Number(raw);
  return Number.isInteger(part) && part >= 1 && part <= 1000 ? { kind: "part", part, explicit: true } : null;
}
