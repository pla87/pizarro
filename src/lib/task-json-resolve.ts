import "server-only";
// Del JSON de una tarea (lib/task-json.ts, ya leído) a lo que se escribe en un proyecto: nombres → ids (tipo, columna,
// responsable, entregable, etiquetas, dependencia), con las mismas reglas que al editar a mano. Lo usan pegar sobre una
// tarea (pasteTaskJson, actions/tasks.ts) e importar varias (importTasks, lib/task-import.ts): un solo sitio para las
// reglas y los avisos. Lo que se lee del proyecto se pide una vez por resolutor (TaskJsonResolver) y solo si hace
// falta: pegar una fecha no lee las etiquetas, e importar 500 tareas no lee los tipos 500 veces.
// También está aquí el lado de copiar: las tareas como objetos «pizarro.task» (taskJsonObjects, para copiar y exportar).
import { z } from "zod";
import { db } from "./db";
import { lockProject } from "./caps";
import { listKinds } from "./board";
import { projectUsersWhere } from "./access";
import { generalKindNames, localizeGeneralKind } from "./kinds-localize";
import { normalizeSearch } from "./search-accents";
import { mentionsToPlain } from "./mentions";
import { clampTitle } from "./title-clamp";
import { ellipsize } from "./graphemes";
import { dateToIso } from "./dates";
import { rateLimit } from "./rate-limit";
import { isWhite, LABEL_CREATE_PER_MINUTE, MAX_DESCRIPTION, MAX_LABELS_PER_PROJECT, MAX_SUBTASKS, MAX_TASK_LABELS, MAX_TITLE, PALETTE } from "./constants";
import { normalizeTaskFields, startAfterDue, type TaskFieldKey } from "./task-fields";
import { enabledTaskFields, fieldKeyOf } from "./task-field-input";
import { RECURRENCES, type RecurrenceRule } from "./recurrence-date";
import { GOOGLE_FILE_KINDS, type GoogleFileKind } from "./google-files";
import { appUrl } from "./mail";
import * as v from "./validation";
import { buildTaskJson, GOOGLE_FILE_URL_RE, TASK_JSON_FIELD_LABEL, TASK_JSON_MAX_CHARS, type TaskJsonField, type TaskJsonInput } from "./task-json";
import type { CurrentUser } from "./session";
import type { Locale, T } from "@/i18n/core";
import type { Prisma } from "@/generated/prisma/client";

/** Subtareas que se leen de un JSON como mucho (por tarea caben MAX_SUBTASKS; hasta aquí, las de más se avisan). */
const PASTED_SUBTASKS_READ = 5000;

/** Cotas de lo que llega ya normalizado por task-json.ts (las reglas finas de cada campo se aplican después, una a una). */
const pastedTaskSchema = z.object({
  title: z.string().max(10_000).optional(),
  description: z.string().max(TASK_JSON_MAX_CHARS).optional(),
  type: z.string().max(500).optional(),
  column: z.string().max(500).optional(),
  labels: z.array(z.string().max(500)).max(500).optional(),
  assignee: z.object({ id: z.string().max(100).optional(), name: z.string().max(500).optional(), email: z.string().max(500).optional() }).nullable().optional(),
  dueDate: z.string().max(40).nullable().optional(),
  startDate: z.string().max(40).nullable().optional(),
  priority: v.taskPriority.optional(),
  client: z.string().max(5000).nullable().optional(),
  cost: z.string().max(60).nullable().optional(),
  costPaid: z.boolean().optional(),
  estimatedHours: z.string().max(60).nullable().optional(),
  actualHours: z.string().max(60).nullable().optional(),
  recurrence: z.object({ rule: z.enum(RECURRENCES), day: z.number().int().min(1).max(31).nullable().optional() }).optional(),
  color: z.string().max(40).nullable().optional(),
  deliverable: z.string().max(500).nullable().optional(),
  link: z.string().max(10_000).nullable().optional(),
  subtasks: z.array(z.object({ text: z.string().max(10_000), done: z.boolean() })).max(PASTED_SUBTASKS_READ).optional(),
  dependsOn: z.object({ id: z.string().max(100).optional(), title: z.string().max(10_000).optional() }).nullable().optional(),
  googleDocs: z.array(z.object({ kind: z.enum(GOOGLE_FILE_KINDS), title: z.string().max(10_000), url: z.string().max(10_000) })).max(500).optional(),
  info: z.object({ id: z.string().max(100).optional(), projectId: z.string().max(100).optional() }).optional(),
}).strict();
export type PastedTask = z.infer<typeof pastedTaskSchema>;

/** Nombre (clave de traducción) de cada campo del formato, para los avisos de lo que no se pudo aplicar. */
export const PASTE_FIELD_NAME = TASK_JSON_FIELD_LABEL;

/**
 * Comprueba las cotas de una tarea leída del JSON. Un error de zod se convierte en un mensaje que se entiende (en el
 * idioma de quien pega): «El JSON trae 6000 subtareas…» o «no se puede leer «etiquetas»».
 */
export function checkPastedTask(task: TaskJsonInput, t: T): { ok: true; data: PastedTask } | { ok: false; error: string } {
  const r = pastedTaskSchema.safeParse(task);
  if (r.success) return { ok: true, data: r.data };
  const issue = r.error.issues[0];
  const field = issue?.path[0];
  if (field === "subtasks" && issue?.code === "too_big" && issue.path.length === 1) {
    return { ok: false, error: t("El JSON trae {n} subtareas y se leen como mucho {max} (una tarea admite {per}).", { n: task.subtasks?.length ?? 0, max: PASTED_SUBTASKS_READ, per: MAX_SUBTASKS }) };
  }
  const name = typeof field === "string" && field in PASTE_FIELD_NAME ? t(PASTE_FIELD_NAME[field as TaskJsonField]) : String(field ?? "?");
  return { ok: false, error: t("El JSON de la tarea no es válido: «{field}» es demasiado largo o no se entiende.", { field: name }) };
}

/** Comparación de nombres sin mayúsculas, tildes ni espacios repetidos. */
export const foldName = (s: string) => normalizeSearch(s).replace(/\s+/g, " ").trim();
/** Un nombre del JSON dentro de un aviso: corto y sin saltos de línea. */
export const quoteName = (s: string) => ellipsize(s.replace(/\s+/g, " "), 40);

/** Campos de la tarjeta que salen del JSON, ya comprobados y con ids (lo que acepta updateTask / el alta). */
export interface ResolvedFields {
  title?: string;
  description?: string;
  color?: z.infer<typeof v.color>;
  linkUrl?: string | null;
  dueDate?: string | null;
  recurrence?: RecurrenceRule;
  recurrenceDay?: number | null;
  kindId?: string;
  assigneeId?: string | null;
  deliverableId?: string | null;
  startDate?: string | null;
  priority?: "BAJA" | "MEDIA" | "ALTA" | "URGENTE" | null;
  client?: string | null;
  cost?: string | null;
  costPaid?: boolean;
  estimatedHours?: string | null;
  actualHours?: string | null;
}

/** Lo que se lee de una persona asignable. */
type Person = { id: string; name: string; email: string };

/**
 * Datos del proyecto destino para resolver nombres, leídos una vez y solo cuando hacen falta. `skip` recibe los avisos
 * (textos ya traducidos) de lo que no se puede aplicar.
 */
export class TaskJsonResolver {
  private memo = new Map<string, Promise<unknown>>();
  constructor(
    readonly user: CurrentUser,
    readonly projectId: string,
    readonly t: T,
    readonly locale: Locale,
  ) {}

  private once<R>(key: string, load: () => Promise<R>): Promise<R> {
    let p = this.memo.get(key) as Promise<R> | undefined;
    if (!p) {
      p = load();
      this.memo.set(key, p);
    }
    return p;
  }

  kinds() {
    return this.once("kinds", () => listKinds(this.projectId));
  }
  columns() {
    return this.once("columns", () => db.column.findMany({ where: { projectId: this.projectId }, orderBy: { position: "asc" }, select: { id: true, name: true, role: true } }));
  }
  enabled(): Promise<TaskFieldKey[]> {
    return this.once("enabled", () => enabledTaskFields(this.projectId));
  }
  private people(): Promise<Person[]> {
    return this.once("people", async () => {
      const project = await db.project.findUniqueOrThrow({ where: { id: this.projectId }, select: { isPrivate: true } });
      return db.user.findMany({ where: { active: true, ...projectUsersWhere(project, this.projectId) }, select: { id: true, name: true, email: true } });
    });
  }
  private deliverables() {
    return this.once("deliverables", () => db.deliverable.findMany({ where: { projectId: this.projectId }, select: { id: true, name: true } }));
  }
  /** Etiquetas del proyecto (la lista crece con las que crea ensureLabels). */
  labels(): Promise<{ id: string; name: string }[]> {
    return this.once("labels", () => db.label.findMany({ where: { projectId: this.projectId }, select: { id: true, name: true } }));
  }
  /** Tareas activas del proyecto (id y título en forma comparable): para buscar una dependencia por título sin leer las archivadas. */
  private activeTitles() {
    return this.once("active", async () =>
      (await db.task.findMany({ where: { projectId: this.projectId, archivedAt: null }, select: { id: true, title: true } })).map((x) => ({ id: x.id, key: foldName(mentionsToPlain(x.title)) })),
    );
  }

  /**
   * Tipo por nombre: el traducido, el guardado o, para los generales de serie, su nombre en el otro idioma (una tarea
   * exportada con la interfaz en inglés trae «Bug fix» y se importa en español como «Corrección», y al revés).
   */
  async kindId(name: string): Promise<string | undefined> {
    const kinds = await this.kinds();
    const want = foldName(name);
    return (
      kinds.find((k) => foldName(localizeGeneralKind(k, this.locale).name) === want) ??
      kinds.find((k) => foldName(k.name) === want) ??
      kinds.find((k) => generalKindNames(k).some((n) => foldName(n) === want))
    )?.id;
  }
  /** Columna por nombre. */
  async columnId(name: string): Promise<string | undefined> {
    const want = foldName(name);
    return (await this.columns()).find((c) => foldName(c.name) === want)?.id;
  }

  /**
   * Responsable: por id (activo y con acceso al proyecto) y, si no, por nombre (si solo hay una persona con ese nombre).
   * Por email solo si quien pega es administrador o es su propio email: un miembro no puede averiguar de quién es un email.
   */
  async assigneeId(a: { id?: string; name?: string; email?: string }): Promise<string | undefined> {
    const people = await this.people();
    if (a.id) {
      const byId = people.find((p) => p.id === a.id);
      if (byId) return byId.id;
    }
    if (a.name) {
      const name = foldName(a.name);
      const same = people.filter((p) => foldName(p.name) === name);
      if (same.length === 1) return same[0]!.id;
    }
    const email = a.email?.trim().toLowerCase();
    if (email && (this.user.role === "ADMIN" || email === this.user.email.toLowerCase())) return people.find((p) => p.email.toLowerCase() === email)?.id;
    return undefined;
  }

  /**
   * Los campos de la tarjeta del JSON, comprobados uno a uno. `current`: fechas guardadas de la tarea (al pegar sobre una)
   * para la regla «inicio no posterior a la fecha límite».
   */
  async fields(json: PastedTask, skip: (what: string) => void, current: { dueDate: string | null; startDate: string | null } | null = null): Promise<ResolvedFields> {
    const t = this.t;
    const out: ResolvedFields = {};
    if (json.title !== undefined) out.title = json.title;
    if (json.description !== undefined) {
      if (json.description.length > MAX_DESCRIPTION) skip(t("descripción (demasiado larga)"));
      else out.description = json.description;
    }
    if (json.color !== undefined) {
      const c = v.color.safeParse(json.color);
      if (c.success) out.color = c.data;
      else skip(t("color"));
    }
    if (json.link !== undefined) {
      const l = json.link === null ? null : v.linkUrl.safeParse(json.link);
      if (l === null) out.linkUrl = null;
      else if (l.success) out.linkUrl = l.data;
      else skip(t("enlace"));
    }
    if (json.dueDate !== undefined) {
      const d = v.dayIso.safeParse(json.dueDate);
      if (d.success) out.dueDate = d.data;
      else skip(t("fecha límite"));
    }
    if (json.recurrence !== undefined) {
      out.recurrence = json.recurrence.rule;
      if (json.recurrence.day !== undefined) out.recurrenceDay = json.recurrence.day;
    }
    if (json.type !== undefined) {
      const kind = await this.kindId(json.type);
      if (kind) out.kindId = kind;
      else skip(t("tipo «{name}» (no existe)", { name: quoteName(json.type) }));
    }
    if (json.assignee !== undefined) {
      if (json.assignee === null) out.assigneeId = null;
      else {
        const who = await this.assigneeId(json.assignee);
        if (who) out.assigneeId = who;
        else skip(t("responsable «{name}» (sin acceso al proyecto)", { name: quoteName(json.assignee.name ?? json.assignee.email ?? json.assignee.id ?? "") }));
      }
    }
    if (json.deliverable !== undefined) {
      if (json.deliverable === null) out.deliverableId = null;
      else {
        const want = foldName(json.deliverable);
        const found = (await this.deliverables()).find((d) => foldName(d.name) === want);
        if (found) out.deliverableId = found.id;
        else skip(t("entregable «{name}» (no existe)", { name: quoteName(json.deliverable) }));
      }
    }
    // Campos opcionales: solo los que el proyecto tiene activados, con las mismas reglas que al editarlos.
    const optional = [
      ["startDate", v.dayIso], ["priority", v.taskPriority], ["client", v.taskClient], ["cost", v.taskCost], ["costPaid", z.boolean()],
      ["estimatedHours", v.taskHours], ["actualHours", v.taskHours],
    ] as const;
    if (optional.some(([key]) => json[key] !== undefined)) {
      const enabled = await this.enabled();
      for (const [key, schema] of optional) {
        if (json[key] === undefined) continue;
        if (!enabled.includes(fieldKeyOf(key))) {
          skip(t("{field} (campo no activado)", { field: t(PASTE_FIELD_NAME[key]) }));
          continue;
        }
        const r = schema.safeParse(json[key]);
        if (r.success) (out as Record<string, unknown>)[key] = r.data;
        else skip(t(PASTE_FIELD_NAME[key]));
      }
      if (enabled.includes("startDate") && (out.startDate !== undefined || out.dueDate !== undefined)) {
        const start = out.startDate !== undefined ? out.startDate : (current?.startDate ?? null);
        const due = out.dueDate !== undefined ? out.dueDate : (current?.dueDate ?? null);
        if (startAfterDue(start, due)) {
          // Se conserva la fecha límite pegada; la de inicio que no encaja no se escribe (o, si era la guardada, se quita).
          if (out.startDate) delete out.startDate;
          else out.startDate = null;
          skip(t("fecha de inicio (posterior a la fecha límite)"));
        }
      }
    } else if (out.dueDate !== undefined && current?.startDate && startAfterDue(current.startDate, out.dueDate) && (await this.enabled()).includes("startDate")) {
      out.startDate = null;
      skip(t("fecha de inicio (posterior a la fecha límite)"));
    }
    return out;
  }

  /** Subtareas del JSON en una línea y recortadas, como mucho MAX_SUBTASKS (las de más se avisan). */
  subtasks(list: { text: string; done: boolean }[], skip: (what: string) => void): { title: string; done: boolean }[] {
    let wanted = list.map((s) => ({ title: clampTitle(s.text, MAX_TITLE, MAX_TITLE).value.trim(), done: s.done })).filter((s) => s.title);
    if (wanted.length > MAX_SUBTASKS) {
      wanted = wanted.slice(0, MAX_SUBTASKS);
      skip(this.t("subtareas (máximo {max} por tarea)", { max: MAX_SUBTASKS }));
    }
    return wanted;
  }

  /** Nombres de etiquetas de una tarea: sin repetir y como mucho MAX_TASK_LABELS (las de más se avisan). */
  labelNames(names: string[], skip: (what: string) => void): string[] {
    if (names.length <= MAX_TASK_LABELS) return names;
    skip(this.t("etiquetas (máximo {max} por tarea)", { max: MAX_TASK_LABELS }));
    return names.slice(0, MAX_TASK_LABELS);
  }

  /**
   * Ids de las etiquetas con esos nombres (sin mirar mayúsculas ni tildes); las que no existen se crean si caben (tope del
   * proyecto y ritmo), todas en una transacción. `skipOf(name)` da a quién avisar de la que no se puede crear (al importar,
   * a cada tarea que la pedía). Devuelve el id por nombre plegado y las creadas (para el deshacer).
   */
  async ensureLabels(names: string[], skipOf: (name: string) => (what: string) => void): Promise<{ ids: Map<string, string>; created: string[] }> {
    const t = this.t;
    const existing = await this.labels();
    const ids = new Map<string, string>();
    for (const l of existing) if (!ids.has(foldName(l.name))) ids.set(foldName(l.name), l.id);
    const wanted: { key: string; name: string; clean: string | null }[] = [];
    const seen = new Set<string>();
    const labelName = v.name.max(40);
    for (const name of names) {
      const key = foldName(name);
      if (ids.has(key) || seen.has(key)) continue;
      seen.add(key);
      const clean = labelName.safeParse(name);
      wanted.push({ key, name, clean: clean.success && rateLimit(`create-label:${this.user.id}`, LABEL_CREATE_PER_MINUTE, 60_000) ? clean.data : null });
    }
    const created: string[] = [];
    const toCreate = wanted.filter((w) => w.clean !== null);
    if (toCreate.length) {
      const colors = PALETTE.filter((c) => !isWhite(c));
      const rows = await db.$transaction(async (tx) => {
        await lockProject(tx, this.projectId);
        const room = Math.max(0, MAX_LABELS_PER_PROJECT - (await tx.label.count({ where: { projectId: this.projectId } })));
        const batch = toCreate.slice(0, room);
        if (!batch.length) return [];
        const made = await tx.label.createManyAndReturn({
          data: batch.map((w, i) => ({ projectId: this.projectId, name: w.clean!, color: colors[(existing.length + i) % colors.length]! })),
          skipDuplicates: true,
          select: { id: true, name: true },
        });
        // Otra pestaña la creó a la vez (mismo nombre): se usa la suya.
        const missing = batch.filter((w) => !made.some((m) => m.name === w.clean)).map((w) => w.clean!);
        const theirs = missing.length ? await tx.label.findMany({ where: { projectId: this.projectId, name: { in: missing } }, select: { id: true, name: true } }) : [];
        return [...made.map((m) => ({ ...m, mine: true })), ...theirs.map((m) => ({ ...m, mine: false }))];
      });
      for (const r of rows) {
        existing.push({ id: r.id, name: r.name });
        if (!ids.has(foldName(r.name))) ids.set(foldName(r.name), r.id);
        if (r.mine) created.push(r.id);
      }
    }
    // Avisos en el orden de los nombres pedidos (nombre de más de 40 caracteres, ritmo o tope de 50 etiquetas).
    for (const w of wanted) if (!ids.has(w.key)) skipOf(w.name)(t("etiqueta «{name}» (no se ha podido crear)", { name: quoteName(w.name) }));
    return { ids, created };
  }

  /**
   * La tarea del proyecto que bloquearía a cada una: por id y, si no, por título (una activa con ese título; si no hay
   * ninguna, una archivada, buscada con una consulta acotada). Un título repetido no se adivina. `exclude`: la propia tarea.
   * Todas a la vez: una consulta por los ids, la lista de activas (id y título) y una por los títulos de archivadas.
   */
  async blockers(reqs: { id?: string; title?: string; exclude?: string }[]): Promise<(string | null)[]> {
    const ids = [...new Set(reqs.flatMap((r) => (r.id && v.id.safeParse(r.id).success ? [r.id] : [])))];
    const byId = new Set(ids.length ? (await db.task.findMany({ where: { id: { in: ids }, projectId: this.projectId }, select: { id: true } })).map((x) => x.id) : []);
    const out: (string | null)[] = reqs.map((r) => (r.id && byId.has(r.id) && r.id !== r.exclude ? r.id : null));
    const byTitle = reqs.map((r, i) => (out[i] === null && r.title ? i : -1)).filter((i) => i >= 0);
    if (!byTitle.length) return out;
    const active = await this.activeTitles();
    const index = new Map<string, string[]>();
    for (const a of active) (index.get(a.key) ?? index.set(a.key, []).get(a.key)!).push(a.id);
    const archivedWanted: number[] = [];
    for (const i of byTitle) {
      const r = reqs[i]!;
      const found = (index.get(foldName(r.title!)) ?? []).filter((id) => id !== r.exclude);
      if (found.length === 1) out[i] = found[0]!;
      else if (!found.length) archivedWanted.push(i);
    }
    if (archivedWanted.length) {
      const titles = [...new Set(archivedWanted.map((i) => reqs[i]!.title!.trim()))].slice(0, 500);
      const rows = await db.task.findMany({
        where: { projectId: this.projectId, archivedAt: { not: null }, OR: titles.map((title) => ({ title: { equals: title, mode: "insensitive" as const } })) },
        select: { id: true, title: true },
        take: titles.length * 2 + 10,
      });
      for (const i of archivedWanted) {
        const r = reqs[i]!;
        const want = foldName(r.title!);
        const same = rows.filter((x) => x.id !== r.exclude && foldName(mentionsToPlain(x.title)) === want);
        if (same.length === 1) out[i] = same[0]!.id;
      }
    }
    return out;
  }
}

/** ¿El JSON dice que la tarea viene de OTRO proyecto? (sin `info` no se sabe: se trata como del mismo). */
export function fromOtherProject(json: PastedTask, projectId: string): boolean {
  return !!json.info?.projectId && json.info.projectId !== projectId;
}

/** Documentos de Google del JSON que se pueden enlazar (solo de Google por https, enlace razonable). */
export function pastedDocs(docs: NonNullable<PastedTask["googleDocs"]>): { kind: GoogleFileKind; title: string; url: string }[] {
  return docs
    .filter((d) => GOOGLE_FILE_URL_RE.test(d.url) && d.url.length <= 2000)
    .map((d) => ({ kind: d.kind, title: d.title.replace(/\s+/g, " ").trim().slice(0, 300) || d.url.slice(0, 300), url: d.url }));
}

/** Documentos de Google enlazados por tarea: al pegar, al importar y al crearlos desde la tarea (createGoogleFile). */
export const MAX_TASK_DOCS = 100;

const JSON_TASK_SELECT = {
  id: true, projectId: true, title: true, description: true, color: true, linkUrl: true, dueDate: true, createdAt: true, updatedAt: true,
  recurrence: true, recurrenceDay: true, cost: true, costPaid: true, estimatedHours: true, actualHours: true, priority: true, client: true, startDate: true,
  project: { select: { name: true, taskFields: true } },
  kind: { select: { id: true, name: true } },
  column: { select: { name: true } },
  assignee: { select: { id: true, name: true } },
  createdBy: { select: { name: true } },
  deliverable: { select: { name: true } },
  blockedBy: { select: { id: true, title: true } },
  labels: { select: { label: { select: { name: true } } } },
  subtasks: { orderBy: { position: "asc" }, select: { title: true, done: true } },
  links: { orderBy: [{ createdAt: "asc" }, { id: "asc" }], select: { kind: true, title: true, url: true } },
  attachments: { orderBy: [{ createdAt: "asc" }, { id: "asc" }], select: { id: true, originalName: true } },
} as const satisfies Prisma.TaskSelect;

/**
 * Las tareas que cumplen `where` como objetos «pizarro.task» (en el orden de `orderBy`), con nombres en vez de ids y solo
 * el id y el nombre del responsable (nunca su email). Quien llama ya ha comprobado el acceso (lo filtra `where`).
 */
export async function taskJsonObjects(where: Prisma.TaskWhereInput, locale: Locale, orderBy?: Prisma.TaskOrderByWithRelationInput[]): Promise<{ id: string; projectId: string; title: string; json: Record<string, unknown> }[]> {
  const rows = await db.task.findMany({ where, select: JSON_TASK_SELECT, ...(orderBy ? { orderBy } : {}) });
  const base = appUrl();
  const dec = (d: { toFixed(n: number): string } | null) => (d === null ? null : d.toFixed(2));
  return rows.map((task) => ({
    id: task.id,
    projectId: task.projectId,
    title: task.title,
    json: buildTaskJson({
      info: {
        id: task.id,
        project: task.project.name,
        projectId: task.projectId,
        url: `${base}/p/${task.projectId}?task=${task.id}`,
        createdAt: task.createdAt.toISOString(),
        updatedAt: task.updatedAt.toISOString(),
        createdBy: task.createdBy?.name ?? null,
      },
      title: task.title,
      description: task.description,
      type: localizeGeneralKind(task.kind, locale).name,
      column: task.column.name,
      labels: task.labels.map((l) => l.label.name).sort((a, b) => a.localeCompare(b, "es")),
      assignee: task.assignee ? { id: task.assignee.id, name: task.assignee.name } : null,
      dueDate: dateToIso(task.dueDate),
      recurrence: task.recurrence,
      recurrenceDay: task.recurrenceDay,
      color: task.color,
      deliverable: task.deliverable?.name ?? null,
      link: task.linkUrl,
      subtasks: task.subtasks.map((s) => ({ text: s.title, done: s.done })),
      dependsOn: task.blockedBy ? { id: task.blockedBy.id, title: mentionsToPlain(task.blockedBy.title) } : null,
      googleDocs: task.links.map((l) => ({ kind: l.kind, title: l.title, url: l.url })),
      attachments: task.attachments.map((a) => ({ name: a.originalName, url: `${base}/api/attachments/${a.id}` })),
      enabledFields: normalizeTaskFields(task.project.taskFields),
      startDate: dateToIso(task.startDate),
      priority: task.priority,
      client: task.client,
      cost: dec(task.cost),
      costPaid: task.costPaid,
      estimatedHours: dec(task.estimatedHours),
      actualHours: dec(task.actualHours),
    }),
  }));
}

