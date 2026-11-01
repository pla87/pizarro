// Formato de exportación/importación de un proyecto («.pizarro.zip»). Sin dependencias de servidor.
//
// Contenido del ZIP:
//   manifest.json      → ExportManifest (formato, versión, opciones, recuentos y SHA-256 de cada fichero)
//   project.json       → ProjectExportData (todo el proyecto, con ids locales de exportación: «c1», «t12»…)
//   files/<sha256>     → un fichero binario por contenido distinto (solo con la opción «Con adjuntos»)
//
// Las referencias («ref») son ids propios del archivo, asignados en orden: nunca son ids de la base de datos.
// Las personas se guardan como {nombre, email}; al importar se emparejan por email con usuarios activos.
import { z } from "zod";
import { COLUMN_ROLES, HEX_COLOR_RE, MAX_DESCRIPTION, MAX_RELEASE_CONTENT, MAX_TEMPLATE } from "../constants";
import { GOOGLE_SHARE_MODES } from "../google-share";
import { TASK_FIELDS, TASK_PRIORITIES } from "../task-fields";

export const EXPORT_FORMAT = "pizarro-project";
/** Versión del formato que escribe esta aplicación. Subirla exige añadir su paso en `upgrade` (upgrade.ts). */
export const EXPORT_FORMAT_VERSION = 1;
export const EXPORT_EXTENSION = ".pizarro.zip";

export const EXPORT_SCOPES = ["board", "all"] as const;
export type ExportScope = (typeof EXPORT_SCOPES)[number];

export interface ExportOptions {
  attachments: boolean;
  scope: ExportScope;
}

// Límites de forma (el importador no se fía del archivo).
export const LIMITS = {
  tasks: 200_000,
  perTask: 2000,
  releases: 20_000,
  events: 2_000_000,
  files: 50_000,
  users: 5_000,
} as const;

const ref = z.string().min(1).max(40);
const iso = z.string().datetime({ offset: true });
/** Día real del calendario (no «2026-02-31»). */
const day = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((s) => {
    const d = new Date(`${s}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
  }, "día no válido");
/** Entero que cabe en una columna Int de PostgreSQL. */
const INT_MAX = 2147483647;
const int = () => z.number().int().max(INT_MAX);
const text = (max: number) => z.string().max(max);
const decimal = z.string().regex(/^\d{1,10}(\.\d{1,2})?$/);
const sha = z.string().regex(/^[0-9a-f]{64}$/);
const hex = z.string().regex(HEX_COLOR_RE);

const person = ref.nullable();

export const userSchema = z.object({ ref, name: text(200), email: text(200) });

const columnSchema = z.object({
  ref,
  name: text(80),
  position: z.number().finite(),
  role: z.enum(COLUMN_ROLES),
  isDone: z.boolean(),
  waitingDays: z.number().int().min(1).max(365).nullable(),
  /** Columna a la que va la siguiente aparición de una tarea recurrente (solo rol ROUTINES). */
  routineTargetRef: ref.nullable(),
});

const kindSchema = z.object({
  ref,
  name: text(80),
  color: hex,
  position: z.number().finite(),
  titleTemplate: text(MAX_TEMPLATE),
  descriptionTemplate: text(MAX_TEMPLATE),
  subtaskTemplate: z.array(text(300)).max(50),
  /** Para conservar el orden entre tipos con la misma posición (opcional: archivos de 1.36 no lo traen). */
  createdAt: iso.optional(),
  /** project = tipo propio del proyecto; general = tipo general usado por sus tareas (al importar se empareja por nombre). */
  scope: z.enum(["project", "general"]),
});

const labelSchema = z.object({ ref, name: text(80), color: hex });

const deliverableSchema = z.object({ ref, name: text(200), description: text(MAX_DESCRIPTION), dueDate: day.nullable(), position: z.number().finite(), createdAt: iso });

const attachmentSchema = z.object({
  originalName: text(300),
  mimeType: text(200),
  isImage: z.boolean(),
  width: int().nullable(),
  height: int().nullable(),
  size: int().min(0),
  createdBy: person,
  createdAt: iso,
  /** SHA-256 del fichero en files/<sha>. */
  file: sha,
});

const commentSchema = z.object({
  ref,
  author: person,
  /** Nombre original si la persona ya no existía al exportar. */
  authorName: text(200).nullable(),
  /** Con las menciones como @[Nombre](user:<ref de persona>). */
  body: text(100_000),
  createdAt: iso,
  editedAt: iso.nullable(),
  parentRef: ref.nullable(),
  deletedAt: iso.nullable(),
});

const taskSchema = z.object({
  ref,
  title: text(500),
  description: text(MAX_DESCRIPTION * 2),
  columnRef: ref,
  kindRef: ref,
  color: hex.nullable(),
  linkUrl: text(2000).nullable(),
  position: z.number().finite(),
  assignee: person,
  createdBy: person,
  dueDate: day.nullable(),
  startDate: day.nullable(),
  deliverableRef: ref.nullable(),
  archivedAt: iso.nullable(),
  archivedFromColumnRef: ref.nullable(),
  columnEnteredAt: iso,
  evergreen: z.boolean(),
  evergreenEvery: z.number().int().min(1).max(1000),
  cost: decimal.nullable(),
  costPaid: z.boolean(),
  estimatedHours: decimal.nullable(),
  actualHours: decimal.nullable(),
  priority: z.enum(TASK_PRIORITIES).nullable(),
  client: text(200).nullable(),
  recurrence: z.enum(["NONE", "DAILY", "WEEKLY", "MONTHLY"]),
  recurrenceDay: z.number().int().min(1).max(31).nullable(),
  /** Tarea de la que salió esta aparición (solo si también está en el archivo). */
  recurrenceFromRef: ref.nullable(),
  /** Última columna ROUTINES en la que estuvo (de ahí sale su siguiente aparición). */
  routineColumnRef: ref.nullable().optional(),
  /** Cuándo se avisó de la espera en una columna WAITING (evita avisos repetidos tras importar). */
  waitingNotifiedAt: iso.nullable().optional(),
  contentUpdatedByRef: person.optional(),
  contentUpdatedAt: iso.nullable(),
  createdAt: iso,
  updatedAt: iso,
  labelRefs: z.array(ref).max(200),
  subtasks: z.array(z.object({ title: text(500), done: z.boolean(), position: z.number().finite() })).max(LIMITS.perTask),
  followers: z.array(z.object({ user: ref, muted: z.boolean(), createdAt: iso.optional() })).max(LIMITS.users),
  comments: z.array(commentSchema).max(LIMITS.perTask * 5),
  attachments: z.array(attachmentSchema).max(LIMITS.perTask),
  links: z.array(z.object({ kind: z.enum(["GOOGLE_DOC", "GOOGLE_SHEET"]), title: text(300), url: text(2000), createdBy: person, createdAt: iso })).max(LIMITS.perTask),
});

const releaseSchema = z.object({
  ref,
  number: int().min(1),
  title: text(300),
  content: text(MAX_RELEASE_CONTENT * 2),
  createdBy: person,
  deployedAt: iso,
  tasks: z.array(z.object({ taskRef: ref.nullable(), title: text(500), kindName: text(80) })).max(LIMITS.tasks),
  attachments: z.array(z.object({ fileName: text(300), size: int().min(0), isImage: z.boolean(), position: int().min(0), createdAt: iso, file: sha })).max(LIMITS.perTask * 10),
});

const documentSchema = z.object({
  ref,
  name: text(300),
  mimeType: text(200),
  size: int().min(0),
  kind: z.enum(["TEXT", "MARKDOWN", "PDF", "IMAGE", "OTHER"]),
  createdBy: person,
  createdAt: iso,
  updatedAt: iso,
  file: sha,
});

const eventSchema = z.object({
  taskRef: ref,
  user: person,
  userName: text(200),
  code: text(60),
  label: text(400),
  createdAt: iso,
});

export const projectDataSchema = z.object({
  users: z.array(userSchema).max(LIMITS.users),
  project: z.object({
    name: text(200),
    description: text(2000),
    /** Solo el tipo de visibilidad: los miembros no se exportan. */
    visibility: z.enum(["TEAM", "PRIVATE"]),
    taskFields: z.array(z.enum(TASK_FIELDS)).max(TASK_FIELDS.length),
    releaseZipMaxMb: z.number().int().min(1).max(5000),
    taskAttachMaxMb: z.number().int().min(1).max(5000),
    fileMaxMb: z.number().int().min(1).max(1000),
    googleShareMode: z.enum(GOOGLE_SHARE_MODES).nullable(),
  }),
  /** Informe semanal: sin destinatario (al importar lo recibe quien importa). */
  reportSchedule: z.object({ enabled: z.boolean(), weekday: z.number().int().min(1).max(7), hour: z.number().int().min(0).max(23) }).nullable(),
  releaseTemplates: z.array(z.object({ kind: z.enum(["HEADER", "FOOTER"]), name: text(200), content: text(MAX_TEMPLATE), position: z.number().finite(), createdAt: iso.optional() })).max(100),
  columns: z.array(columnSchema).min(1).max(200),
  kinds: z.array(kindSchema).max(500),
  /** Nombres de los tipos generales que el proyecto no usa. */
  hiddenGeneralKinds: z.array(text(80)).max(500),
  labels: z.array(labelSchema).max(500),
  deliverables: z.array(deliverableSchema).max(1000),
  tasks: z.array(taskSchema).max(LIMITS.tasks),
  releases: z.array(releaseSchema).max(LIMITS.releases),
  documents: z.array(documentSchema).max(1000),
  events: z.array(eventSchema).max(LIMITS.events),
});

export type ProjectExportData = z.infer<typeof projectDataSchema>;
export type ExportUser = z.infer<typeof userSchema>;
export type ExportTask = z.infer<typeof taskSchema>;
export type ExportRelease = z.infer<typeof releaseSchema>;
export type ExportDocument = z.infer<typeof documentSchema>;

export const COUNT_KEYS = ["columns", "kinds", "labels", "deliverables", "tasks", "archivedTasks", "subtasks", "comments", "taskAttachments", "releases", "releaseAttachments", "documents", "events", "files"] as const;
export type ExportCounts = Record<(typeof COUNT_KEYS)[number], number>;

export const manifestSchema = z.object({
  format: z.literal(EXPORT_FORMAT),
  formatVersion: int().min(1),
  appVersion: text(40),
  exportedAt: iso,
  options: z.object({ attachments: z.boolean(), scope: z.enum(EXPORT_SCOPES) }),
  counts: z.record(z.string(), int().min(0)),
  /** Zona horaria de la instancia que exporta (el día y la hora del informe semanal van en ella). */
  timeZone: text(80).optional(),
  /** SHA-256 (hex) de cada fichero del ZIP salvo manifest.json: «project.json» y «files/<sha>». */
  checksums: z.record(z.string(), sha),
});

export type ExportManifest = z.infer<typeof manifestSchema>;
