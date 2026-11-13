import "server-only";
import { randomBytes } from "node:crypto";
import { appendFile, mkdir, readdir, readFile, rm, stat, utimes, writeFile } from "node:fs/promises";
import path from "node:path";
import { db } from "../db";
import { logEvent } from "../log";
import { uploadDir } from "../upload-dir";
import { removeAttachmentFiles, removeDocumentFiles, removeReleaseAttachmentFiles } from "../uploads";

// Registro de una importación en curso (UPLOAD_DIR/imports/<id>.import-journal). La importación escribe los ficheros
// antes de crear las filas (en una sola transacción al final): si el proceso muere entre medias, esos ficheros quedan
// sin fila. Pasadas 24 h la limpieza de huérfanos los borraría, pero en una importación grande suelen ser más de la mitad
// de los ficheros y esa limpieza se cancela por seguridad (tope del 50 %) día tras día. Con el registro se sabe
// exactamente qué ficheros escribió una importación que no terminó, y se borran solo esos.
//
// Formato: una línea «p <id del proyecto>» y después una por fichero, escrita ANTES de guardarlo: «a <id>» (adjunto de
// tarea, con su miniatura), «r <id>» (adjunto de release) o «d <id>» (documento). Mientras la importación sigue viva, el
// registro se toca cada JOURNAL_TOUCH_MS; uno que lleva más de JOURNAL_STALE_MS sin tocarse es de un proceso que murió.

const EXT = ".import-journal";
const JOURNAL_TOUCH_MS = 10_000;
/** Sin tocar desde hace esto, el registro es de una importación que murió con su proceso. */
const JOURNAL_STALE_MS = 2 * 60_000;
const ID_RE = /^[a-z0-9]{8,40}$/;

type Kind = "a" | "r" | "d";

/** Registros que este proceso tiene abiertos (nunca se tratan como abandonados aquí, aunque su fecha se retrase). */
const active = ((globalThis as unknown as { __pzImportJournals?: Set<string> }).__pzImportJournals ??= new Set<string>());

const journalDir = () => path.join(uploadDir(), "imports");

interface ImportJournal {
  /** Anota un fichero antes de escribirlo. */
  record(kind: Kind, id: string): Promise<void>;
  /** La importación terminó (bien, o mal y ya borró sus ficheros): el registro sobra. */
  close(): Promise<void>;
}

/** Abre el registro de la importación que creará el proyecto `projectId`. `name`: el id del trabajo, si lo hay. */
export async function openImportJournal(projectId: string, name: string = randomBytes(8).toString("hex")): Promise<ImportJournal> {
  const safe = name.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 60) || randomBytes(8).toString("hex");
  const file = path.join(journalDir(), `${safe}${EXT}`);
  await mkdir(journalDir(), { recursive: true });
  await writeFile(file, `p ${projectId}\n`);
  active.add(file);
  const touch = setInterval(() => {
    const now = new Date();
    void utimes(file, now, now).catch(() => {});
  }, JOURNAL_TOUCH_MS);
  touch.unref?.();
  return {
    record: (kind, id) => appendFile(file, `${kind} ${id}\n`),
    async close() {
      clearInterval(touch);
      await rm(file, { force: true }).catch(() => {});
      active.delete(file);
    },
  };
}

/** Lee un registro: proyecto y ficheros anotados (las líneas que no se entienden se ignoran). */
export function parseImportJournal(text: string): { projectId: string | null; files: Record<Kind, string[]> } {
  const files: Record<Kind, string[]> = { a: [], r: [], d: [] };
  let projectId: string | null = null;
  for (const line of text.split("\n")) {
    const m = /^([pard]) (\S+)$/.exec(line.trim());
    if (!m || !ID_RE.test(m[2]!)) continue;
    if (m[1] === "p") projectId ??= m[2]!;
    else files[m[1] as Kind].push(m[2]!);
  }
  return { projectId, files };
}

/**
 * Borra los ficheros de las importaciones que no terminaron (el proceso murió a mitad: reinicio, despliegue, falta de
 * memoria). Solo registros que no son de este proceso y llevan más de `staleMs` sin tocarse. Si el proyecto llegó a
 * crearse, la importación terminó y solo sobra el registro; si no, se borran los ficheros anotados que no tienen fila
 * (comprobado una vez más contra la base de datos) y el registro. Devuelve cuántos ficheros se borraron. Nunca lanza.
 */
export async function recoverImportJournals(now: number = Date.now(), staleMs: number = JOURNAL_STALE_MS): Promise<number> {
  let names: string[];
  try {
    names = (await readdir(journalDir())).filter((n) => n.endsWith(EXT));
  } catch {
    return 0; // sin carpeta imports/: nada pendiente
  }
  let removed = 0;
  for (const name of names) {
    const file = path.join(journalDir(), name);
    if (active.has(file)) continue;
    try {
      const st = await stat(file);
      if (now - st.mtimeMs < staleMs) continue;
      const { projectId, files } = parseImportJournal(await readFile(file, "utf8"));
      const committed = projectId ? (await db.project.count({ where: { id: projectId } })) > 0 : false;
      if (!committed) {
        // Por si acaso, nunca un fichero que tenga fila (los ids son nuevos y aleatorios, pero no cuesta comprobarlo).
        const [a, r, d] = await Promise.all([
          files.a.length ? db.taskAttachment.findMany({ where: { id: { in: files.a } }, select: { id: true } }) : [],
          files.r.length ? db.releaseAttachment.findMany({ where: { id: { in: files.r } }, select: { id: true } }) : [],
          files.d.length ? db.projectDocument.findMany({ where: { id: { in: files.d } }, select: { id: true } }) : [],
        ]);
        const without = (ids: string[], rows: { id: string }[]) => {
          const keep = new Set(rows.map((x) => x.id));
          return ids.filter((id) => !keep.has(id));
        };
        const doomed = { a: without(files.a, a), r: without(files.r, r), d: without(files.d, d) };
        await Promise.all([removeAttachmentFiles(doomed.a), removeReleaseAttachmentFiles(doomed.r), removeDocumentFiles(doomed.d)]);
        const count = doomed.a.length + doomed.r.length + doomed.d.length;
        removed += count;
        logEvent({
          level: "warn", category: "system", action: "projects.importCleaned",
          message: `Importación de un proyecto interrumpida: borrados los ${count} ficheros que había escrito`,
          details: { journal: name, files: count, attachments: doomed.a.length, releaseAttachments: doomed.r.length, documents: doomed.d.length },
        });
      }
      await rm(file, { force: true });
    } catch (err) {
      console.error("[import] no se pudo revisar el registro de importación", name, err);
    }
  }
  return removed;
}
