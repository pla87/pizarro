// Plan de trabajo para una IA (columna con rol AI_PLAN): el texto en Markdown que se entrega a un agente (p. ej. Claude
// Code) para que haga las tareas de la columna. Funciones puras: se usan en el navegador (al generar) y en las pruebas.
// Reutiliza las piezas de las release notes (plantillas de cabecera y pie, cambio de cabecera o pie en el texto editado).
// Sin enlaces a Pizarro (a la tarea, al proyecto, a los adjuntos ni los de las descripciones): la IA no puede abrirlos
// (piden la sesión iniciada). Los adjuntos se citan por su ruta en el ZIP que va con el plan, o por su nombre.

import { FENCE_CLOSE, FENCE_OPEN, withoutEmptyFormSections } from "./form-sections";
import { formatDay } from "./dates";
import { decodeEntities } from "./markdown-entities";
import { mentionsToPlain } from "./mentions";
import { plainAttachmentFileNames, releaseTemplateText } from "./release";
import { esT, type T } from "@/i18n/shared";
import { MAX_RELEASE_CONTENT } from "./constants";

export interface AiPlanTask {
  id: string;
  title: string;
  /** Nombre del tipo, ya en el idioma de quien genera el plan. */
  kind?: string | null;
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
  /**
   * Adjuntos con su nombre y, si el plan va con su ZIP, su ruta dentro de él (`adjuntos/03-titulo/plano.webp`, o
   * `attachments/…` en un plan en inglés; ver planAttachmentPaths).
   */
  attachments?: { id?: string; name: string; path?: string }[];
  /** Tarea que bloquea a esta (si está en el plan, `index` es su número en él, desde 1). */
  blockedBy?: { title: string; index?: number | null } | null;
}

export interface AiPlanInput {
  header: string;
  footer: string;
  project: { name: string; description?: string | null };
  /** Nombre de la columna de la que sale el plan. */
  column?: string | null;
  /** Fecha del plan (YYYY-MM-DD, zona de la app). */
  date: string;
  /**
   * Idioma de Intl del plan (es-ES, en-US): la fecha del contexto se escribe como en el resto de la app y en el título de
   * las releases («24 nov 2026», «Nov 24, 2026»). Por defecto, es-ES.
   */
  intlLocale?: string;
  tasks: AiPlanTask[];
  /**
   * Origen de la app (https://pizarro.example.com): un enlace de las descripciones que empieza por él (o por «/», relativo a
   * la app) es un enlace a Pizarro y se queda en su texto (ver planDescription).
   */
  origin?: string | null;
}

/** Idioma del plan: decide el nombre de la carpeta raíz del ZIP y el de una tarea sin letras en el título. */
type AiPlanLocale = "es" | "en";
/**
 * Carpeta raíz del ZIP de adjuntos del plan, en el idioma del plan: dentro, una carpeta por tarea
 * («adjuntos/03-titulo-de-la-tarea», «attachments/03-task-title»).
 */
const AI_PLAN_ZIP_ROOTS: Record<AiPlanLocale, string> = { es: "adjuntos", en: "attachments" };
/** Nombre de la carpeta de una tarea cuyo título no deja ninguna letra ni cifra («03-tarea», «03-task»). */
const FOLDER_FALLBACK: Record<AiPlanLocale, string> = { es: "tarea", en: "task" };
/** Forma de la carpeta de una tarea en el ZIP (el servidor solo admite esta, con una de las dos raíces). */
export const AI_PLAN_ZIP_FOLDER = /^(?:adjuntos|attachments)\/\d{2,4}-[a-z0-9-]{0,40}$/;
/** Raíz de una carpeta de tarea ya validada con AI_PLAN_ZIP_FOLDER («adjuntos» o «attachments»). */
export const aiPlanZipRoot = (folder: string) => folder.slice(0, folder.indexOf("/"));

/** Parte de un título apta para el nombre de una carpeta: minúsculas, sin tildes, guiones entre palabras. */
function folderSlug(title: string, locale: AiPlanLocale): string {
  return mentionsToPlain(title).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40).replace(/-+$/, "") || FOLDER_FALLBACK[locale];
}

/**
 * Dónde queda cada adjunto de las tareas del plan dentro del ZIP: `adjuntos/03-titulo-de-la-tarea/plano.webp` (03 = el
 * número de la tarea en el plan, el de «### 3.»; las imágenes van convertidas a WebP, como en el ZIP de la release; si dos
 * nombres coinciden en la misma tarea, el segundo lleva «-2»). Devuelve la carpeta y las rutas por tarea (solo las que
 * tienen adjuntos) y la ruta de cada adjunto por su id (las imágenes pegadas en una descripción apuntan a él). El
 * servidor recalcula los nombres con las mismas funciones (src/app/api/projects/[projectId]/release-attachments/route.ts).
 * `locale`: idioma del plan; en inglés la raíz es `attachments/` y una tarea sin letras, `03-task`.
 */
export function planAttachmentPaths(tasks: { id: string; title: string; attachments: { id: string; originalName: string; isImage?: boolean }[] }[], locale: AiPlanLocale = "es") {
  const width = Math.max(2, String(tasks.length).length);
  const byTask = new Map<string, { folder: string; files: { id: string; path: string }[] }>();
  const byAttachment = new Map<string, string>();
  tasks.forEach((task, i) => {
    if (!task.attachments.length) return;
    const folder = `${AI_PLAN_ZIP_ROOTS[locale]}/${String(i + 1).padStart(width, "0")}-${folderSlug(task.title, locale)}`;
    const names = plainAttachmentFileNames(task.attachments);
    const files = task.attachments.map((a, k) => ({ id: a.id, path: `${folder}/${names[k]!}` }));
    for (const f of files) byAttachment.set(f.id, f.path);
    byTask.set(task.id, { folder, files });
  });
  return { byTask, byAttachment };
}

/**
 * Plantillas de serie del plan (cuando ni la persona ni el proyecto tienen ninguna): pensadas para Claude Code. No se
 * guardan en la base de datos (una cabecera o un pie propio nuevo parte de este texto y desde ahí es suyo): cambiar
 * este texto cambia los planes nuevos que usan la de serie, no las propias. Los adjuntos los explica el contexto del plan,
 * solo cuando los hay.
 */
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

/**
 * Tareas que admite un plan (lo que pide el diálogo al servidor de una vez). El mensaje del límite lleva la cifra escrita:
 * si cambia, cámbialo también allí (src/actions/ai-plan.ts y AiPlanDialog.tsx).
 */
export const AI_PLAN_MAX_TASKS = 500;

/** Lo más largo que se puede guardar en Documentación (el mismo tope que el texto de una release). */
export const AI_PLAN_SAVE_MAX = MAX_RELEASE_CONTENT;
/** Por qué un plan de `n` caracteres no se guarda y qué hacer: lo dicen el botón apagado del paso 2 y el servidor. */
export function aiPlanTooLong(t: T, n: number, locale: string): string {
  const nf = new Intl.NumberFormat(locale);
  return t("El plan tiene {n} caracteres y en Documentación caben como mucho {max}: cópialo con «Copiar todo» o descárgalo en .md, o genera uno con menos tareas.", { n: nf.format(n), max: nf.format(AI_PLAN_SAVE_MAX) });
}

/** Id de las plantillas de serie en el selector de cabecera y pie (no son filas de la base de datos). */
export const AI_PLAN_BUILTIN_ID = "builtin";

/** Escapa lo que rompería el texto de un enlace Markdown. */
const linkText = (text: string) => text.replace(/([[\]\\])/g, "\\$1");
/** Destino de un enlace Markdown entre <>: sin los caracteres que lo cerrarían. */
const linkTarget = (url: string) => `<${url.replace(/[<>\s]/g, (c) => encodeURIComponent(c))}>`;
const oneLine = (text: string) => mentionsToPlain(text).replace(/\s+/g, " ").trim();
/** Nombre de un adjunto en el texto: en `código` (un «_» o un «*» del nombre no da formato), o tal cual si lleva «`». */
const fileName = (name: string) => (name.includes("`") ? oneLine(name) : `\`${oneLine(name)}\``);

/** Título ATX (hasta 3 espacios delante; «#» solo también es un título, vacío). */
const ATX_HEADING = /^ {0,3}(#{1,6})(?=\s|$)(.*)$/;
/** Subrayado de un título setext («Texto» y debajo «===» o «---»). */
const SETEXT_UNDERLINE = /^ {0,3}(=+|-+)\s*$/;
/** Línea que no puede ser texto de un título setext: en blanco, lista, cita, tabla, título, bloque de código o con sangría de código. */
const NOT_PARAGRAPH = /^(?:\s*$| {4}|\t| {0,3}(?:[-*+](?:\s|$)|\d{1,9}[.)](?:\s|$)|>|\||#|`{3}|~{3}|(?:[-*_] *){3,}$))/;
/**
 * Comienzo de un bloque HTML de los que no acaban en una línea en blanco (CommonMark, tipos 1 a 5): `<!--`, `<?`, `<!X`,
 * `<![CDATA[`, `<pre`, `<script`, `<style` y `<textarea`. Uno que no se cierra se traga el resto del plan (las demás
 * tareas y el pie) en la vista previa y en cualquier visor de Markdown.
 */
const HTML_BLOCK_START = /^( {0,3})(<(?:!--|\?|!\[CDATA\[|![A-Za-z]|(?:pre|script|style|textarea)(?=[\s>]|$)))/i;
/**
 * Enlace o imagen de Markdown en línea: «!» (imagen), texto (sin corchetes sin escapar), destino (entre <> o sin espacios)
 * y título opcional. Un texto con corchetes anidados no casa y el enlace se queda como está.
 */
const INLINE_LINK = /(!?)\[((?:\\.|[^\\[\]\n])*)\]\((\s*)(<[^<>\n]*>|[^\s()<>]+)((?:\s+(?:"[^"\n]*"|'[^'\n]*'|\([^()\n]*\)))?\s*)\)/g;
/** Un adjunto de la app (`/api/attachments/<id>`, con o sin parámetros): su id. */
const ATTACHMENT_PATH = /^\/api\/attachments\/([\w-]+)(?:[?#].*)?$/;

/**
 * Ruta dentro de la app de un enlace a Pizarro: relativo a ella («/p/…», «/api/attachments/…») o con su origen
 * (sin distinguir mayúsculas); null si lleva a otro sitio.
 */
function appPathOf(url: string, origin: string | null | undefined): string | null {
  if (url.startsWith("/")) return url.startsWith("//") ? null : url;
  const base = origin?.replace(/\/+$/, "");
  if (!base || url.slice(0, base.length).toLowerCase() !== base.toLowerCase() || !/^(?:[/?#]|$)/.test(url.slice(base.length))) return null;
  return url.slice(base.length) || "/";
}

/**
 * Texto alternativo que solo repite el nombre del fichero («pegada.png», el que pone el editor al pegar una imagen): acaba
 * en una extensión de imagen o de fichero habitual. Cualquier punto no basta: «Figura 3.14» o «Ver www.ejemplo.com» son
 * texto de verdad y se conservan.
 */
const FILE_NAME_ALT = /\.(?:png|jpe?g|gif|webp|heic|heif|avif|bmp|svg|tiff?|ico|pdf|txt|md|csv|json|xml|log|zip|docx?|xlsx?|pptx?|od[tsp]|rtf)$/i;

/** Marca de un código en línea apartado (maskCodeSpans): dos caracteres de uso privado que el texto normal no lleva. */
const CODE_MARK = /\uE000(\d+)\uE001/g;

/**
 * Aparta los códigos en línea de una línea (`` `…` ``, con tantas comillas invertidas de cierre como de apertura, como en
 * CommonMark; `\`` fuera de código es una comilla suelta) y los cambia por una marca. Lo de dentro de un código es texto
 * literal: un `![x](/api/attachments/…)` citado así no se reescribe (la ruta entre comillas invertidas cerraba el código).
 */
function maskCodeSpans(line: string): { masked: string; spans: string[] } {
  const spans: string[] = [];
  if (!line.includes("`") || line.includes("\uE000")) return { masked: line, spans };
  let masked = "";
  let i = 0;
  while (i < line.length) {
    const c = line[i]!;
    if (c === "\\") {
      masked += line.slice(i, i + 2);
      i += 2;
      continue;
    }
    if (c !== "`") {
      masked += c;
      i++;
      continue;
    }
    let open = i;
    while (line[open] === "`") open++;
    const run = open - i;
    let close = -1;
    for (let k = open; k < line.length; ) {
      if (line[k] !== "`") {
        k++;
        continue;
      }
      let end = k;
      while (line[end] === "`") end++;
      if (end - k === run) {
        close = k;
        break;
      }
      k = end;
    }
    if (close < 0) {
      masked += line.slice(i, open);
      i = open;
      continue;
    }
    masked += `\uE000${spans.length}\uE001`;
    spans.push(line.slice(i, close + run));
    i = close + run;
  }
  return { masked, spans };
}

/**
 * Enlaces e imágenes de una línea de descripción que llevan a Pizarro (appPathOf): un adjunto que va en el ZIP pasa a su
 * ruta dentro de él, escrita como texto («imagen `adjuntos/03-…/pegada.webp`», y un enlace, «plano (`adjuntos/…`)»): como
 * imagen de Markdown, el editor con barra y la vista de Documentación solo enseñaban «[imagen: pegada.png]», sin la ruta.
 * Los demás se quedan en su texto (la imagen, en su texto alternativo), porque la IA no puede abrirlos. Los enlaces a otros
 * sitios no cambian. `cited` recoge los ids de los adjuntos que han pasado a su ruta del ZIP.
 */
const IMAGE_OPEN = "\u0001";
const IMAGE_CLOSE = "\u0002";
const IMAGE_MARKS = /[\u0001\u0002]/g;
const IMAGE_IN_LINK = /\[[^\]\u0002]*\u0001[^\]]*\]\(/;

function withoutAppLinks(line: string, t: T, origin: string | null | undefined, paths: ReadonlyMap<string, string> | undefined, cited?: Set<string>): string {
  if (!line.includes("](")) return line;
  const { masked, spans } = maskCodeSpans(line);
  const replace = (from: string) => from.replace(INLINE_LINK, (whole: string, bang: string, text: string, _space: string, dest: string) => {
    const appPath = appPathOf(dest.startsWith("<") ? dest.slice(1, -1) : dest, origin);
    if (appPath === null) return whole;
    const id = ATTACHMENT_PATH.exec(appPath)?.[1] ?? "";
    const zipped = paths?.get(id);
    if (!zipped) return text;
    cited?.add(id);
    const path = `\`${zipped}\``;
    // El texto de un enlace que envuelve una imagen: sin las marcas de la imagen (no se parte la línea por un enlace).
    const alt = text.replace(IMAGE_MARKS, "").trim();
    // El enlace de fuera de una imagen enlazada al mismo adjunto: la ruta ya está en su texto, no se repite.
    if (!bang) return !alt ? path : alt.includes(path) ? alt : `${alt} (${path})`;
    const image = alt && !FILE_NAME_ALT.test(alt) ? t("imagen «{alt}» ({path})", { alt, path }) : t("imagen {path}", { path });
    return `${IMAGE_OPEN}${image}${IMAGE_CLOSE}`;
  });
  // Dos pasadas: una imagen enlazada (`[![a](…)](…)`) solo deja ver el enlace de fuera cuando ya se ha sustituido la imagen.
  const once = replace(masked);
  const replaced = once === masked ? once : replace(once);
  // La imagen, en su propia línea (un salto antes y otro después): un párrafo con la imagen dentro se leía «…la tabla.imagen `…`».
  // Dentro del texto de un enlace no se parte (se rompería el enlace).
  const twice = replaced.includes(IMAGE_OPEN)
    ? IMAGE_IN_LINK.test(replaced)
      ? replaced.replace(IMAGE_MARKS, "")
      : replaced.replace(/[ \t]*\u0001/g, "\n\n").replace(/\u0002[ \t]*/g, "\n\n")
    : replaced;
  return spans.length ? twice.replace(CODE_MARK, (_m, n: string) => spans[Number(n)]!) : twice;
}

/**
 * Descripción de una tarea tal como entra en el plan: menciones en texto plano, entidades decodificadas (descripciones
 * antiguas con `&gt;`), sin enlaces a Pizarro (withoutAppLinks) y títulos rebajados tres niveles (bajo el «### n. Tarea» del plan),
 * también los setext («Texto» subrayado con === o ---), que pasan a «####». Dentro de los bloques de código no se toca
 * nada; uno sin cerrar se cierra al final (si no, se tragaría el resto del plan: las demás tareas y el pie). Por lo mismo,
 * una línea que abriría un bloque HTML sin fin (`<!-- nota`, `<pre`, `<script`…) empieza con «\<». Sin líneas en blanco
 * repetidas ni al principio o al final; los saltos de línea forzados (dos espacios al final) se conservan. Sin los
 * apartados del formulario del tipo que siguen vacíos (withoutEmptyFormSections). `cited`: recoge los ids de los adjuntos que
 * la descripción cita por su ruta en el ZIP (la lista «Adjuntos» de la tarea ya no los repite). `t`: idioma del plan (el
 * «imagen» de las imágenes del ZIP).
 */
export function planDescription(description: string | null | undefined, origin?: string | null, paths?: ReadonlyMap<string, string>, cited?: Set<string>, t: T = esT): string {
  const text = decodeEntities(mentionsToPlain(description ?? ""));
  const out: string[] = [];
  /** Apertura del bloque de código en curso («```», «````», «~~~»…). */
  let fence: string | null = null;
  /** Líneas seguidas de texto normal al final de `out` (las que un subrayado setext convertiría en título). */
  let paragraph = 0;
  for (const raw of withoutEmptyFormSections(text.split(/\r\n|\r|\n/))) {
    const blank = raw.trim() === "";
    if (fence) {
      const close = FENCE_CLOSE.exec(raw)?.[1];
      if (close && close[0] === fence[0] && close.length >= fence.length) fence = null;
      out.push(blank ? "" : raw);
      continue;
    }
    const open = FENCE_OPEN.exec(raw);
    if (open && !(open[1]![0] === "`" && open[2]!.includes("`"))) {
      fence = open[1]!;
      paragraph = 0;
      out.push(raw);
      continue;
    }
    if (blank) {
      paragraph = 0;
      if (out.length > 0 && out.at(-1) !== "") out.push("");
      continue;
    }
    const setext = paragraph > 0 ? SETEXT_UNDERLINE.exec(raw)?.[1] : undefined;
    if (setext) {
      const lines = out.splice(out.length - paragraph, paragraph).map((l) => l.trim());
      out.push(`${"#".repeat(setext[0] === "=" ? 4 : 5)} ${lines.join(" ")}`);
      paragraph = 0;
      continue;
    }
    // Fuera de los bloques de código: sin enlaces a Pizarro (un adjunto del ZIP, por su ruta en él).
    const withLinks = withoutAppLinks(raw, t, origin, paths, cited);
    // Una imagen del ZIP parte la línea: cada trozo se trata como una línea suelta (los vacíos, como líneas en blanco).
    for (const line of withLinks.split("\n")) {
      if (line.trim() === "") {
        paragraph = 0;
        if (out.length > 0 && out.at(-1) !== "") out.push("");
        continue;
      }
      const heading = ATX_HEADING.exec(line);
      if (heading) {
        out.push(`${"#".repeat(Math.min(6, heading[1]!.length + 3))}${heading[2]!.trimEnd()}`);
        paragraph = 0;
        continue;
      }
      paragraph = NOT_PARAGRAPH.test(line) ? 0 : paragraph + 1;
      // Fuera de los bloques de código, «\<» al principio: se ve igual (un «<») y no abre un bloque HTML.
      out.push(line.replace(HTML_BLOCK_START, "$1\\$2"));
    }
  }
  while (out.at(-1) === "") out.pop();
  if (fence) out.push(fence);
  return out.join("\n");
}

/** Primera línea que, tras una lista de datos, se uniría a ella: una viñeta, un número de lista o sangría. */
const LIST_OR_INDENT_START = /^(?:\s|[-*+](?:\s|$)|\d{1,9}[.)](?:\s|$))/;

/**
 * Una descripción que va justo después de una lista de datos («- **Tipo:** …»): sin rótulo, salvo si empieza con una
 * lista (o con sangría). La línea en blanco no las separa: en Markdown sus viñetas pasarían a ser datos de la tarea.
 */
const afterFacts = (description: string, t: T) => (LIST_OR_INDENT_START.test(description) ? `**${t("Descripción")}:**\n\n${description}` : description);

/**
 * Lo que comparten todas las tareas del plan y ya dice el contexto (una vez, arriba): el tipo, la prioridad y las etiquetas
 * que llevan todas. No se repite en cada tarea (en un plan de cientos, una o dos líneas menos por tarea).
 */
interface SharedFacts {
  kind: string | null;
  priority: string | null;
  labels: ReadonlySet<string>;
}

function formatTask(task: AiPlanTask, index: number, t: T, shared: SharedFacts, origin?: string | null, paths?: ReadonlyMap<string, string>): string {
  const facts: string[] = [];
  const fact = (label: string, value: string) => facts.push(`- **${label}:** ${value}`);
  if (task.kind && !shared.kind) fact(t("Tipo"), oneLine(task.kind));
  if (task.priority && !shared.priority) fact(t("Prioridad"), task.priority);
  const labels = (task.labels ?? []).map(oneLine).filter((l) => !shared.labels.has(l));
  if (labels.length) fact(t("Etiquetas"), labels.join(", "));
  if (task.startDate) fact(t("Fecha de inicio"), task.startDate);
  if (task.dueDate) fact(t("Fecha límite"), task.dueDate);
  // Una tarea del plan, por su número (su título ya está en su «### n.»); una de fuera, por su título.
  if (task.blockedBy) fact(t("Depende de"), task.blockedBy.index ? t("la tarea {n}", { n: task.blockedBy.index }) : t("{title} (no está en este plan)", { title: `«${oneLine(task.blockedBy.title)}»` }));
  // El enlace externo de la tarea, salvo que lleve a Pizarro (a otra tarea, al tablero…).
  if (task.linkUrl && appPathOf(task.linkUrl, origin) === null) fact(t("Enlace"), `[${linkText(task.linkUrl)}](${linkTarget(task.linkUrl)})`);
  if (task.links?.length) fact(t("Documentos"), task.links.map((l) => `[${linkText(oneLine(l.title))}](${linkTarget(l.url)})`).join(", "));
  // Antes que la lista de adjuntos: los que la descripción ya cita por su ruta del ZIP no se repiten en ella.
  const cited = new Set<string>();
  const description = planDescription(task.description, origin, paths, cited, t);
  const files = (task.attachments ?? []).filter((a) => !(a.id && a.path && cited.has(a.id)));
  // Los adjuntos van al final de la tarea, en un párrafo (no en la lista de datos de arriba: tras la checklist, una viñeta
  // más sería otra subtarea).
  let attachments = "";
  if (files.some((a) => a.path)) {
    // Con ZIP, su ruta dentro de él. Todos los de una tarea van en su carpeta: con varios, la carpeta se dice una vez.
    const folderOf = (p: string) => p.slice(0, p.lastIndexOf("/") + 1);
    const folder = files[0]!.path ? folderOf(files[0]!.path) : "";
    if (files.length === 1) attachments = `**${t("Adjuntos")}:** \`${files[0]!.path}\``;
    else if (folder && files.every((a) => a.path && folderOf(a.path) === folder)) {
      attachments = `**${t("Adjuntos")}** (${t("en la carpeta {folder}", { folder: `\`${folder}\`` })}): ${files.map((a) => `\`${a.path!.slice(folder.length)}\``).join(", ")}`;
    } else attachments = [`**${t("Adjuntos")}:**`, "", ...files.map((a) => `- ${a.path ? `\`${a.path}\`` : fileName(a.name)}`)].join("\n");
  } else if (files.length) {
    // Sin ZIP, solo su nombre (sin enlace a Pizarro: la IA no puede abrirlo).
    attachments = `**${t("Adjuntos")}:** ${files.map((a) => fileName(a.name)).join(", ")}`;
  }
  const parts = [`### ${index}. ${oneLine(task.title)}`];
  if (facts.length) parts.push(facts.join("\n"));
  // La descripción va sin rótulo (sigue a los datos; ver afterFacts) y la checklist sin «criterios de aceptación» (lo dice
  // la cabecera).
  if (description) parts.push(facts.length ? afterFacts(description, t) : description);
  if (task.subtasks?.length) {
    parts.push(`**${t("Checklist")}:**`, task.subtasks.map((s) => `- [${s.done ? "x" : " "}] ${oneLine(s.title)}`).join("\n"));
  }
  if (attachments) parts.push(attachments);
  return parts.join("\n\n");
}

/** Tipo, prioridad y etiquetas comunes a todas las tareas (con dos o más; ver SharedFacts). */
function sharedFacts(tasks: AiPlanTask[]): SharedFacts {
  if (tasks.length < 2) return { kind: null, priority: null, labels: new Set() };
  const same = (values: string[]) => (new Set(values).size === 1 ? values[0] || null : null);
  const [first, ...rest] = tasks.map((x) => new Set((x.labels ?? []).map(oneLine)));
  const labels = new Set([...first!].filter((l) => rest.every((r) => r.has(l))));
  return {
    kind: same(tasks.map((x) => (x.kind ? oneLine(x.kind) : ""))),
    priority: same(tasks.map((x) => x.priority ?? "")),
    labels,
  };
}

/**
 * Texto del plan: título, cabecera (instrucciones generales), contexto del proyecto, una sección por tarea (en el orden
 * de la columna) y pie (instrucciones de entrega). `t`: idioma de quien lo genera; sin él, en español.
 */
export function buildAiPlanMarkdown(input: AiPlanInput, t: T = esT): string {
  const zipped = input.tasks.flatMap((x) => x.attachments ?? []).filter((a) => a.path);
  // Con adjuntos pero sin ZIP (más de 200 tareas con adjuntos), una cabecera propia copiada de la de serie de antes puede
  // hablar de un ZIP: no se toca (así se puede cambiar de plantilla en el texto ya editado, swapTemplateBlock) y la línea
  // del contexto lo desmiente. Con ZIP, la línea del contexto es la que explica cómo usarlo.
  const namesOnly = !zipped.length && input.tasks.some((x) => x.attachments?.length);
  const header = releaseTemplateText(input.header);
  const footer = releaseTemplateText(input.footer);
  const context = [`## ${t("Contexto del proyecto")}`, ""];
  const projectName = oneLine(input.project.name);
  context.push(`- **${t("Proyecto")}:** ${projectName}`);
  if (input.column) context.push(`- **${t("Columna")}:** ${oneLine(input.column)}`);
  context.push(`- **${t("Fecha")}:** ${formatDay(input.date, undefined, input.intlLocale ?? "es-ES")}`);
  context.push(`- **${t("Tareas")}:** ${input.tasks.length}`);
  // Lo que comparten todas las tareas se dice una vez aquí y no en cada una (en un plan de cientos, líneas menos por tarea).
  const shared = sharedFacts(input.tasks);
  if (shared.kind) context.push(`- **${t("Tipo de todas las tareas")}:** ${shared.kind}`);
  if (shared.priority) context.push(`- **${t("Prioridad de todas las tareas")}:** ${shared.priority}`);
  if (shared.labels.size) context.push(`- **${t("Etiquetas de todas las tareas")}:** ${[...shared.labels].join(", ")}`);
  if (namesOnly) context.push(`- **${t("Adjuntos")}:** ${t("Este plan no lleva ZIP de adjuntos: cada tarea cita solo el nombre de los suyos (pídelos si los necesitas), aunque las instrucciones hablen de un ZIP.")}`);
  if (zipped.length) context.push(`- **${t("Adjuntos")}:** ${t("{n} archivo(s) en el ZIP «adjuntos/…» que va con este plan (descomprímelo junto a este fichero): cada tarea cita la ruta de los suyos, también la de las imágenes de su descripción. Las imágenes van en WebP.", { n: zipped.length })}`);
  const description = planDescription(input.project.description, input.origin);
  if (description) context.push("", afterFacts(description, t));
  const pathById = new Map(zipped.filter((a) => a.id).map((a) => [a.id!, a.path!]));
  const tasks = input.tasks.length
    ? input.tasks.map((task, i) => formatTask(task, i + 1, t, shared, input.origin, pathById))
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
