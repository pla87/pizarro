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

// Cada paquete se arma entero en memoria (hasta el tope del proyecto, unos 2× al comprimir): uno a la vez por
// persona y como mucho dos en todo el servidor, para que varias descargas en paralelo no agoten la RAM.
const zipSlots = ((globalThis as unknown as { __pzZipSlots?: { users: Set<string>; active: number } }).__pzZipSlots ??= { users: new Set(), active: 0 });
const MAX_ZIPS_AT_ONCE = 2;

/** Reserva un hueco para armar un ZIP; null si esa persona ya tiene uno en curso o el servidor está lleno. Llama a la función devuelta al terminar. */
export function acquireZipSlot(userId: string): (() => void) | null {
  if (zipSlots.users.has(userId) || zipSlots.active >= MAX_ZIPS_AT_ONCE) return null;
  zipSlots.users.add(userId);
  zipSlots.active++;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    zipSlots.users.delete(userId);
    zipSlots.active--;
  };
}

/** Tope por petición: el plan tiene el suyo (se consulta al abrir cada release del histórico), los paquetes pedidos por número otro. */
export function zipRateKey(mode: ZipRequestMode, userId: string): { key: string; limit: number } {
  if (mode.kind === "plan") return { key: `release-zip-plan:${userId}`, limit: 60 };
  return mode.explicit ? { key: `release-zip-part:${userId}`, limit: 120 } : { key: `release-zip:${userId}`, limit: 10 };
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
