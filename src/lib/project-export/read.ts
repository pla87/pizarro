import { createHash } from "node:crypto";
import { MAX_ACTIVE_TASKS_PER_PROJECT, MAX_DELIVERABLES_PER_PROJECT, MAX_LABELS_PER_PROJECT, isUniqueColumnRole } from "../constants";
import { DOCUMENTS_MAX_PER_PROJECT } from "../document-kind";
import { AppError } from "../errors";
import { ArchiveError } from "./errors";
import { ZipFile, ZipReadError, type ZipEntryInfo } from "../zip-read";
import { LIMITS, manifestSchema, projectDataSchema, EXPORT_FORMAT, type ExportManifest, type ProjectExportData } from "./types";
import { assertSupportedVersion, upgrade } from "./upgrade";

const MAX_MANIFEST_BYTES = 8 * 1024 * 1024;
const MAX_PROJECT_JSON_BYTES = 64 * 1024 * 1024;
const FILE_ENTRY = /^files\/([0-9a-f]{64})$/;

export interface ProjectArchive {
  zip: ZipFile;
  manifest: ExportManifest;
  data: ProjectExportData;
  /** Entradas de files/<sha> por huella. */
  files: Map<string, ZipEntryInfo>;
}

/** Hash SHA-256 de una entrada leyéndola por trozos (también comprueba su CRC-32 y su tamaño). */
async function sha256Of(zip: ZipFile, entry: ZipEntryInfo): Promise<string> {
  const h = createHash("sha256");
  for await (const chunk of zip.read(entry)) h.update(chunk);
  return h.digest("hex");
}

function parseJson(buf: Buffer, what: string): unknown {
  try {
    return JSON.parse(buf.toString("utf8"));
  } catch {
    throw new ArchiveError("El archivo contiene un JSON no válido.", what);
  }
}

/** Primer fallo del esquema como «ruta: mensaje», para poder localizar el problema. */
function schemaError(what: string, issues: { path: PropertyKey[]; message: string }[]): ArchiveError {
  const first = issues[0];
  return new ArchiveError("El archivo no es válido.", `${what} no es válido: ${first ? `${first.path.map(String).join(".") || "raíz"}: ${first.message}` : "forma incorrecta"}`);
}

/**
 * Abre y valida un archivo de exportación sin escribir nada: ZIP seguro (nombres, tamaños, número de entradas),
 * formato y versión, sumas SHA-256 de todos los ficheros, forma de project.json y coherencia de sus referencias.
 * Quien llama debe cerrar `zip` (archive.zip.close()).
 */
export async function openProjectArchive(file: string): Promise<ProjectArchive> {
  let zip: ZipFile;
  try {
    zip = await ZipFile.open(file);
  } catch (err) {
    if (err instanceof ZipReadError) throw new ArchiveError("El archivo no es un ZIP válido.", err.message);
    throw new AppError("No se pudo leer el archivo.");
  }
  try {
    return await validateArchive(zip);
  } catch (err) {
    await zip.close();
    if (err instanceof ZipReadError) throw new ArchiveError("El archivo está dañado.", err.message);
    throw err;
  }
}

async function validateArchive(zip: ZipFile): Promise<ProjectArchive> {
  const files = new Map<string, ZipEntryInfo>();
  for (const e of zip.entries) {
    if (e.name === "manifest.json" || e.name === "project.json") continue;
    const m = FILE_ENTRY.exec(e.name);
    if (!m) throw new ArchiveError("El archivo contiene una entrada inesperada.", e.name.slice(0, 60));
    files.set(m[1]!, e);
  }
  if (files.size > LIMITS.files) throw new AppError("El archivo tiene demasiados ficheros.");
  const manifestEntry = zip.find("manifest.json");
  const projectEntry = zip.find("project.json");
  if (!manifestEntry || !projectEntry) throw new AppError("No es un archivo de proyecto de Pizarro (falta manifest.json o project.json).");

  if (projectEntry.size > MAX_PROJECT_JSON_BYTES) throw new AppError("El contenido del proyecto (project.json) supera el máximo de 64 MB. Exporta el proyecto sin adjuntos o con «Solo el tablero».");

  // Formato y versión antes que nada: así un archivo de otra aplicación o de una versión futura da un mensaje claro.
  const rawManifest = parseJson(await zip.readAll(manifestEntry, MAX_MANIFEST_BYTES), "manifest.json");
  if (!rawManifest || typeof rawManifest !== "object" || (rawManifest as { format?: unknown }).format !== EXPORT_FORMAT) {
    throw new AppError("No es un archivo de proyecto de Pizarro.");
  }
  // La versión se mira antes que la forma del manifiesto: una versión futura puede haberla cambiado.
  assertSupportedVersion({ formatVersion: Number((rawManifest as { formatVersion?: unknown }).formatVersion) });
  const parsedManifest = manifestSchema.safeParse(rawManifest);
  if (!parsedManifest.success) throw schemaError("manifest.json", parsedManifest.error.issues);
  let manifest = parsedManifest.data;

  // Todas las sumas, en los dos sentidos: nada sin declarar y nada declarado que falte.
  const declared = Object.keys(manifest.checksums);
  const present = zip.entries.map((e) => e.name).filter((n) => n !== "manifest.json");
  if (declared.length !== present.length || !present.every((n) => n in manifest.checksums)) {
    throw new AppError("Las sumas de control del archivo no coinciden con su contenido.");
  }
  for (const name of present) {
    const entry = zip.find(name)!;
    const expected = manifest.checksums[name]!;
    const m = FILE_ENTRY.exec(name);
    if (m && m[1] !== expected) throw new ArchiveError("Una suma de control no coincide con el nombre del fichero.", name.slice(0, 80));
    if ((await sha256Of(zip, entry)) !== expected) throw new ArchiveError("Un fichero del archivo está dañado o ha sido modificado (suma SHA-256 distinta).", name === "project.json" ? name : name.slice(0, 20));
  }

  const rawData = parseJson(await zip.readAll(projectEntry, MAX_PROJECT_JSON_BYTES), "project.json");
  const upgraded = upgrade(manifest, rawData);
  manifest = upgraded.manifest;
  const parsed = projectDataSchema.safeParse(upgraded.data);
  if (!parsed.success) throw schemaError("project.json", parsed.error.issues);
  const data = parsed.data;
  validateRefs(data, new Set(files.keys()));
  return { zip, manifest, data, files };
}

/** Repetidos (distingue mayúsculas: las restricciones únicas de la base de datos también). */
const dup = (what: string, values: string[]) => {
  const seen = new Set<string>();
  for (const v of values) {
    if (seen.has(v)) throw new ArchiveError("El archivo tiene datos repetidos.", `project.json repite ${what}: ${v.slice(0, 60)}`);
    seen.add(v);
  }
  return seen;
};

/** Coherencia de las referencias internas y de los límites que tiene un proyecto normal. */
export function validateRefs(data: ProjectExportData, fileShas: Set<string>): void {
  const columns = dup("una columna", data.columns.map((c) => c.ref));
  const kinds = dup("un tipo", data.kinds.map((k) => k.ref));
  const labels = dup("una etiqueta", data.labels.map((l) => l.ref));
  dup("el nombre de una etiqueta", data.labels.map((l) => l.name));
  const deliverables = dup("un entregable", data.deliverables.map((d) => d.ref));
  const tasks = dup("una tarea", data.tasks.map((t) => t.ref));
  dup("una persona", data.users.map((u) => u.ref));
  dup("una release", data.releases.map((r) => r.ref));
  dup("el número de una release", data.releases.map((r) => String(r.number)));
  dup("un documento", data.documents.map((d) => d.ref));
  for (const role of data.columns.map((c) => c.role).filter(isUniqueColumnRole)) {
    if (data.columns.filter((c) => c.role === role).length > 1) throw new ArchiveError("El archivo tiene varias columnas con un rol único.", `project.json: ${role}`);
  }
  if (data.labels.length > MAX_LABELS_PER_PROJECT) throw new AppError("El proyecto tiene más etiquetas de las permitidas.");
  if (data.deliverables.length > MAX_DELIVERABLES_PER_PROJECT) throw new AppError("El proyecto tiene más entregables de los permitidos.");
  if (data.documents.length > DOCUMENTS_MAX_PER_PROJECT) throw new AppError("El proyecto tiene más documentos de los permitidos.");
  if (data.tasks.filter((t) => !t.archivedAt).length > MAX_ACTIVE_TASKS_PER_PROJECT) throw new AppError("El proyecto tiene más tareas activas de las permitidas.");
  const need = (set: Set<string>, value: string | null, what: string) => {
    if (value !== null && !set.has(value)) throw new ArchiveError("El archivo hace referencia a algo que no existe.", `project.json hace referencia a ${what} que no existe`);
  };
  for (const c of data.columns) need(columns, c.routineTargetRef, "una columna");
  for (const t of data.tasks) {
    need(columns, t.columnRef, "una columna");
    need(kinds, t.kindRef, "un tipo");
    need(deliverables, t.deliverableRef, "un entregable");
    need(columns, t.archivedFromColumnRef, "una columna");
    need(tasks, t.recurrenceFromRef, "una tarea");
    for (const l of t.labelRefs) need(labels, l, "una etiqueta");
    const comments = dup("un comentario", t.comments.map((c) => c.ref));
    for (const c of t.comments) need(comments, c.parentRef, "un comentario");
    for (const a of t.attachments) need(fileShas, a.file, "un fichero");
  }
  const fromRefs = data.tasks.map((t) => t.recurrenceFromRef).filter((r): r is string => !!r);
  dup("la tarea de la que sale una repetición", fromRefs);
  for (const r of data.releases) {
    dup("un adjunto de la release", r.attachments.map((a) => a.fileName));
    for (const x of r.tasks) need(tasks, x.taskRef, "una tarea");
    for (const a of r.attachments) need(fileShas, a.file, "un fichero");
  }
  for (const d of data.documents) need(fileShas, d.file, "un fichero");
  for (const e of data.events) need(tasks, e.taskRef, "una tarea");
}
