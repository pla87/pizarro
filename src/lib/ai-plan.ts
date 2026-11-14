// Plan de trabajo para una IA (columna con rol AI_PLAN): el texto en Markdown que se entrega a un agente (p. ej. Claude
// Code) para que haga las tareas de la columna. Funciones puras: se usan en el navegador (al generar) y en las pruebas.
// Reutiliza las piezas de las release notes (plantillas de cabecera y pie, cambio de cabecera o pie en el texto editado).

import { decodeEntities } from "./markdown-entities";
import { mentionsToPlain } from "./mentions";
import { releaseTemplateText } from "./release";
import { esT, type T } from "@/i18n/shared";

export interface AiPlanTask {
  id: string;
  title: string;
  /** Nombre del tipo, ya en el idioma de quien genera el plan. */
  kind?: string | null;
  /** Enlace a la tarea en la app (absoluto). */
  url?: string | null;
  /** Descripción en Markdown (con menciones @[Nombre](user:ID)). */
  description?: string | null;
  subtasks?: { title: string; done: boolean }[];
  labels?: string[];
  /** YYYY-MM-DD */
  dueDate?: string | null;
  startDate?: string | null;
  /** Prioridad ya traducida («Alta»). */
  priority?: string | null;
  /** Enlace externo de la tarea. */
  linkUrl?: string | null;
  /** Documentos de Google vinculados. */
  links?: { title: string; url: string }[];
  /** Adjuntos con su enlace de descarga en la app (absoluto). */
  attachments?: { name: string; url: string }[];
  /** Tarea fija («Siempre en el plan»): entra en todos los planes. */
  evergreen?: boolean;
  /** Tarea que bloquea a esta (si está en el plan, `index` es su número en él, desde 1). */
  blockedBy?: { title: string; index?: number | null } | null;
}

export interface AiPlanInput {
  header: string;
  footer: string;
  project: { name: string; description?: string | null; url?: string | null };
  /** Nombre de la columna de la que sale el plan. */
  column?: string | null;
  /** Fecha del plan (YYYY-MM-DD, zona de la app). */
  date: string;
  tasks: AiPlanTask[];
  /** Origen de la app (https://pizarro.example.com): convierte en absolutos los enlaces `/api/attachments/…` de las descripciones. */
  origin?: string | null;
}

/** Plantillas de serie del plan (cuando ni la persona ni el proyecto tienen ninguna): pensadas para Claude Code. */
export const AI_PLAN_DEFAULTS: Record<"es" | "en", { headerName: string; header: string; footerName: string; footer: string }> = {
  es: {
    headerName: "Claude Code (de serie)",
    header: [
      "## Instrucciones para la IA",
      "",
      "Eres un agente de programación (por ejemplo, Claude Code) y vas a ejecutar este plan de trabajo en el repositorio del proyecto.",
      "",
      "- Lee el plan completo antes de empezar. Si algo no está claro o falta información, pregunta en vez de suponer.",
      "- Haz las tareas en el orden en que aparecen, salvo que una dependa de otra.",
      "- Las subtareas de cada tarea son su checklist y sus criterios de aceptación: la tarea está terminada cuando se cumplen todas (las marcadas con [x] ya están hechas).",
      "- Haz cambios pequeños y fáciles de revisar, con el estilo y las convenciones que ya tiene el código.",
      "- Añade o actualiza las pruebas de lo que cambies y ejecútalas antes de dar una tarea por terminada.",
      "- No hagas nada irreversible (borrar datos, migraciones destructivas, desplegar o publicar) sin confirmación.",
      "- Los enlaces a Pizarro (tareas y adjuntos) solo se abren con la sesión iniciada: si necesitas alguno y no puedes abrirlo, pídelo.",
    ].join("\n"),
    footerName: "Entrega (de serie)",
    footer: [
      "## Entrega",
      "",
      "Al terminar, responde con:",
      "",
      "1. Un resumen tarea por tarea (número y título): qué has hecho, si queda terminada y, si no, por qué.",
      "2. Los ficheros que has cambiado y las decisiones que convenga revisar.",
      "3. Cómo lo has comprobado: pruebas añadidas o ejecutadas y su resultado.",
      "4. Lo que quede pendiente, las dudas y los riesgos.",
      "",
      "Haz un commit por tarea (o por grupo de cambios relacionados) con un mensaje que diga qué cambia y por qué.",
    ].join("\n"),
  },
  en: {
    headerName: "Claude Code (built-in)",
    header: [
      "## Instructions for the AI",
      "",
      "You are a coding agent (for example, Claude Code) and you are going to carry out this work plan in the project's repository.",
      "",
      "- Read the whole plan before you start. If something is unclear or information is missing, ask instead of guessing.",
      "- Do the tasks in the order they appear, unless one depends on another.",
      "- The subtasks of each task are its checklist and its acceptance criteria: the task is done when all of them are met (those marked [x] are already done).",
      "- Make small changes that are easy to review, following the style and conventions the code already has.",
      "- Add or update tests for what you change and run them before you consider a task done.",
      "- Do nothing irreversible (deleting data, destructive migrations, deploying or publishing) without confirmation.",
      "- Links to Pizarro (tasks and attachments) only open with a signed-in session: if you need one and cannot open it, ask for it.",
    ].join("\n"),
    footerName: "Delivery (built-in)",
    footer: [
      "## Delivery",
      "",
      "When you finish, reply with:",
      "",
      "1. A task-by-task summary (number and title): what you did, whether it is done and, if not, why.",
      "2. The files you changed and the decisions worth reviewing.",
      "3. How you checked it: tests added or run and their result.",
      "4. Anything left pending, open questions and risks.",
      "",
      "Make one commit per task (or per group of related changes) with a message that says what changes and why.",
    ].join("\n"),
  },
};

/** Id de las plantillas de serie en el selector de cabecera y pie (no son filas de la base de datos). */
export const AI_PLAN_BUILTIN_ID = "builtin";

/** Escapa lo que rompería el texto de un enlace Markdown. */
const linkText = (text: string) => text.replace(/([[\]\\])/g, "\\$1");
/** Destino de un enlace Markdown entre <>: sin los caracteres que lo cerrarían. */
const linkTarget = (url: string) => `<${url.replace(/[<>\s]/g, (c) => encodeURIComponent(c))}>`;
const oneLine = (text: string) => mentionsToPlain(text).replace(/\s+/g, " ").trim();

/**
 * Descripción de una tarea tal como entra en el plan: menciones en texto plano, entidades decodificadas (descripciones
 * antiguas con `&gt;`), enlaces a adjuntos absolutos y títulos rebajados tres niveles (bajo el «### n. Tarea» del plan;
 * dentro de los bloques de código no se toca nada). Sin líneas en blanco repetidas ni al principio o al final.
 */
export function planDescription(description: string | null | undefined, origin?: string | null): string {
  let text = decodeEntities(mentionsToPlain(description ?? ""));
  if (origin) text = text.replace(/(\]\(<?)(\/api\/attachments\/)/g, `$1${origin.replace(/\/+$/, "")}$2`);
  const out: string[] = [];
  // Valla abierta (``` o ~~~, con su longitud). La cierra una del mismo carácter, igual o más larga y sin nada detrás
  // (CommonMark); si la descripción termina sin cerrarla, se cierra al final: si no, el resto del plan (las tareas
  // siguientes y el pie) quedaría dentro del bloque de código.
  let fence: string | null = null;
  for (const raw of text.split(/\r\n|\r|\n/)) {
    const line = raw.trimEnd();
    const marker = /^\s{0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    if (marker && !fence) fence = marker[1]!;
    else if (marker && fence && marker[1]![0] === fence[0] && marker[1]!.length >= fence.length && !marker[2]!.trim()) fence = null;
    else if (!fence) {
      const heading = /^(#{1,6})(\s.*)$/.exec(line);
      if (heading) {
        out.push(`${"#".repeat(Math.min(6, heading[1]!.length + 3))}${heading[2]}`);
        continue;
      }
      if (!line && (out.length === 0 || out.at(-1) === "")) continue;
    }
    out.push(line);
  }
  while (out.at(-1) === "") out.pop();
  if (fence) out.push(fence);
  return out.join("\n");
}

function formatTask(task: AiPlanTask, index: number, t: T, origin?: string | null): string {
  const facts: string[] = [];
  const fact = (label: string, value: string) => facts.push(`- **${label}:** ${value}`);
  if (task.kind) fact(t("Tipo"), oneLine(task.kind));
  if (task.priority) fact(t("Prioridad"), task.priority);
  if (task.labels?.length) fact(t("Etiquetas"), task.labels.map(oneLine).join(", "));
  if (task.startDate) fact(t("Fecha de inicio"), task.startDate);
  if (task.dueDate) fact(t("Fecha límite"), task.dueDate);
  if (task.blockedBy) {
    const title = `«${oneLine(task.blockedBy.title)}»`;
    fact(t("Depende de"), task.blockedBy.index ? t("la tarea {n} ({title})", { n: task.blockedBy.index, title }) : t("{title} (no está en este plan)", { title }));
  }
  if (task.url) fact(t("Tarea en Pizarro"), `[${linkText(t("abrir"))}](${linkTarget(task.url)})`);
  if (task.linkUrl) fact(t("Enlace"), `[${linkText(task.linkUrl)}](${linkTarget(task.linkUrl)})`);
  if (task.links?.length) fact(t("Documentos"), task.links.map((l) => `[${linkText(oneLine(l.title))}](${linkTarget(l.url)})`).join(", "));
  if (task.attachments?.length) fact(t("Adjuntos"), task.attachments.map((a) => `[${linkText(a.name)}](${linkTarget(a.url)})`).join(", "));
  if (task.evergreen) facts.push(`- _${t("Tarea fija: entra en todos los planes.")}_`);
  const parts = [`### ${index}. ${oneLine(task.title)}`];
  if (facts.length) parts.push(facts.join("\n"));
  const description = planDescription(task.description, origin);
  if (description) parts.push(`**${t("Descripción")}:**`, description);
  if (task.subtasks?.length) {
    parts.push(`**${t("Checklist (criterios de aceptación)")}:**`, task.subtasks.map((s) => `- [${s.done ? "x" : " "}] ${oneLine(s.title)}`).join("\n"));
  }
  return parts.join("\n\n");
}

/**
 * Texto del plan: título, cabecera (instrucciones generales), contexto del proyecto, una sección por tarea (en el orden
 * de la columna) y pie (instrucciones de entrega). `t`: idioma de quien lo genera; sin él, en español.
 */
export function buildAiPlanMarkdown(input: AiPlanInput, t: T = esT): string {
  const header = releaseTemplateText(input.header);
  const footer = releaseTemplateText(input.footer);
  const context = [`## ${t("Contexto del proyecto")}`, ""];
  const projectName = oneLine(input.project.name);
  context.push(`- **${t("Proyecto")}:** ${input.project.url ? `[${linkText(projectName)}](${linkTarget(input.project.url)})` : projectName}`);
  if (input.column) context.push(`- **${t("Columna")}:** ${oneLine(input.column)}`);
  context.push(`- **${t("Fecha")}:** ${input.date}`);
  context.push(`- **${t("Tareas")}:** ${input.tasks.length}`);
  const description = planDescription(input.project.description, input.origin);
  if (description) context.push("", description);
  const tasks = input.tasks.length
    ? input.tasks.map((task, i) => formatTask(task, i + 1, t, input.origin))
    : [`_${t("Sin tareas seleccionadas.")}_`];
  return [
    `# ${t("Plan de trabajo")} – ${projectName}`,
    header,
    context.join("\n"),
    `## ${t("Tareas")}`,
    ...tasks,
    footer,
  ].filter(Boolean).join("\n\n") + "\n";
}

/** Nombre del documento del plan: «Plan de trabajo – 2026-11-23_v3.md» (`prefix` es «Plan de trabajo» traducido). */
export function aiPlanFileName(prefix: string, date: string, version: number, ext: "md" | "txt" = "md"): string {
  return `${prefix} – ${date}_v${version}.${ext}`;
}

/**
 * Nombre del .md o .txt descargado: el del documento solo con caracteres ASCII («Plan de trabajo - 2026-11-23_v3.md»).
 * Algunos navegadores descartan el nombre del atributo `download` con letras fuera de ASCII (la raya «–», una tilde) y
 * guardan el archivo como «download».
 */
export function aiPlanDownloadName(fileName: string): string {
  return fileName.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[\u2010-\u2015]/g, "-").replace(/[^\x20-\x7e]/g, "_");
}

/** Número de versión más alto en los nombres de documento de planes («…_v12.md» → 12); 0 si no hay ninguno. */
export function highestPlanVersion(names: readonly string[]): number {
  let max = 0;
  for (const name of names) {
    const n = Number(/_v(\d{1,6})\.(?:md|txt)$/i.exec(name)?.[1] ?? 0);
    if (n > max) max = n;
  }
  return max;
}
