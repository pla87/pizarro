// Resumen diario por email: agrupación de lo ocurrido y texto del correo. Funciones puras (sin BD).
import type { T } from "../i18n/core";
import { escapeHtml, noReplyNote, unsubscribeFooter } from "./mail";
import { mentionsToPlain } from "./mentions";

type DigestSectionKey = "assigned" | "mentions" | "notes" | "changes" | "overdue" | "dueToday" | "created" | "done" | "comments";

/** Orden en el que salen las secciones: primero lo que te toca a ti. */
const DIGEST_ORDER: DigestSectionKey[] = ["assigned", "mentions", "notes", "changes", "overdue", "dueToday", "created", "done", "comments"];

/** Máximo de tareas por sección en el correo (el resto se resume en «y N más»). */
export const DIGEST_MAX_ITEMS = 25;

export interface DigestItem {
  /** La tarea; en la sección «notes», vacío (el elemento es la nota de `docId`). */
  taskId: string;
  /** Nota de Documentación en la que te han mencionado (sección «notes», v1.77): `title` es su nombre. */
  docId?: string;
  title: string;
  projectId: string;
  projectName: string;
  /** Comentarios nuevos de la tarea (sección «comments») o menciones en la nota (sección «notes»). */
  count?: number;
  /** Otras tareas del mismo aviso que no salen en la lista (el lote de «Asignación a persona»: «y N más»). */
  more?: number;
}

/** Lo reunido para el resumen, por sección («notes» y «mentions» pueden faltar: solo las rellena quien tiene marcadas las menciones; «changes», quien tiene marcadas las fechas). */
export type DigestInput = Record<Exclude<DigestSectionKey, "notes" | "mentions" | "changes">, DigestItem[]> & { notes?: DigestItem[]; mentions?: DigestItem[]; changes?: DigestItem[] };

interface DigestSection {
  key: DigestSectionKey;
  /** Tareas de la sección (también las que no caben en el correo y las «y N más» de un lote). */
  total: number;
  /** Las que se muestran, agrupadas por proyecto (orden alfabético). */
  projects: { projectId: string; projectName: string; items: DigestItem[] }[];
  /** Las que no caben. */
  hidden: number;
}

export function emptyDigestInput(): DigestInput {
  return { assigned: [], mentions: [], notes: [], changes: [], overdue: [], dueToday: [], created: [], done: [], comments: [] };
}

/** Lo que identifica un elemento del resumen: la tarea o, en «notes», la nota. */
const itemKey = (i: DigestItem): string => (i.docId ? `doc:${i.docId}` : i.taskId);

/**
 * Agrupa por sección y proyecto, sin repetir tareas dentro de una sección, y descarta las secciones vacías. `taskCount`:
 * tareas distintas entre todas las secciones (una tarea asignada, vencida y comentada cuenta una vez), más las «y N más»
 * de los lotes (de esas no se sabe cuáles son: pueden estar también en otra sección).
 */
export function buildDigest(input: DigestInput): { sections: DigestSection[]; empty: boolean; taskCount: number } {
  const sections: DigestSection[] = [];
  const all = new Set<string>();
  let more = 0;
  for (const key of DIGEST_ORDER) {
    const seen = new Set<string>();
    const unique = (input[key] ?? []).filter((i) => !seen.has(itemKey(i)) && !!seen.add(itemKey(i)));
    if (!unique.length) continue;
    const extra = unique.reduce((n, i) => n + (i.more ?? 0), 0);
    more += extra;
    for (const i of unique) all.add(itemKey(i));
    const shown = unique.slice(0, DIGEST_MAX_ITEMS);
    const byProject = new Map<string, DigestSection["projects"][number]>();
    for (const item of shown) {
      const group = byProject.get(item.projectId) ?? { projectId: item.projectId, projectName: item.projectName, items: [] };
      group.items.push(item);
      byProject.set(item.projectId, group);
    }
    sections.push({
      key,
      total: unique.length + extra,
      projects: [...byProject.values()].sort((a, b) => a.projectName.localeCompare(b.projectName)),
      hidden: unique.length - shown.length,
    });
  }
  return { sections, empty: sections.length === 0, taskCount: all.size + more };
}

function heading(key: DigestSectionKey, t: T): string {
  switch (key) {
    case "assigned": return t("Asignadas a ti");
    case "mentions": return t("Te han mencionado en tareas");
    case "notes": return t("Te han mencionado en notas");
    case "changes": return t("Cambios de fecha límite y recordatorios");
    case "overdue": return t("Tus tareas vencidas");
    case "dueToday": return t("Tus tareas que vencen hoy");
    case "created": return t("Tareas nuevas");
    case "done": return t("Tareas completadas");
    default: return t("Comentarios nuevos");
  }
}

function itemText(i: DigestItem, t: T, kind?: DigestSectionKey): string {
  const title = t("«{title}»", { title: mentionsToPlain(i.title) });
  if (i.more) return `${title} ${t("y {n} más", { n: i.more })}`;
  if (i.docId) return i.count && i.count > 1 ? `${title} (${t("{n} menciones", { n: i.count })})` : title;
  return i.count && i.count > 1 ? `${title} (${kind === "mentions" ? t("{n} menciones", { n: i.count }) : kind === "changes" ? t("{n} avisos", { n: i.count }) : t("{n} comentarios", { n: i.count })})` : title;
}

/**
 * Periodo que cubre el resumen (ver gatherDigest): desde el anterior, si fue hace como mucho 48 h; si fue antes, las
 * últimas 48 h; sin resumen anterior, las últimas 24 h.
 */
type DigestPeriod = "sinceLast" | "48h" | "24h";

export function digestPeriod(lastSentAt: Date | null, now: Date): DigestPeriod {
  if (!lastSentAt) return "24h";
  return now.getTime() - lastSentAt.getTime() <= 2 * 24 * 60 * 60 * 1000 ? "sinceLast" : "48h";
}

/** Correo del resumen: asunto, texto plano y HTML (el contenido de los usuarios va escapado). */
export function digestEmail(digest: ReturnType<typeof buildDigest>, opts: { name: string; baseUrl: string; period?: DigestPeriod; unsubscribeUrl?: string }, t: T) {
  const { baseUrl } = opts;
  const link = (i: DigestItem) => (i.docId ? `${baseUrl}/p/${i.projectId}/docs?doc=${i.docId}` : `${baseUrl}/p/${i.projectId}?task=${i.taskId}`);
  // Tareas distintas: antes se sumaban las secciones y una tarea asignada y vencida contaba dos veces.
  const subject = t("Tu resumen diario de Pizarro ({n})", { n: digest.taskCount });
  const period = opts.period ?? "24h";
  const intro = period === "sinceLast"
    ? t("Hola, {name}: esto ha pasado en tus proyectos desde el último resumen.", { name: opts.name })
    : period === "48h"
      ? t("Hola, {name}: esto ha pasado en tus proyectos en las últimas 48 horas.", { name: opts.name })
      : t("Hola, {name}: esto ha pasado en tus proyectos en las últimas 24 horas.", { name: opts.name });
  const optOut = t("Puedes desactivar este resumen en «Mi perfil» de Pizarro.");
  const noReply = noReplyNote(t);
  const unsub = unsubscribeFooter(opts.unsubscribeUrl, t);

  const text = [
    intro,
    ...digest.sections.map((s) =>
      [
        `${heading(s.key, t)} (${s.total})`,
        ...s.projects.flatMap((p) => [`  ${p.projectName}`, ...p.items.map((i) => `    - ${itemText(i, t, s.key)} ${link(i)}`)]),
        ...(s.hidden ? [`    ${t("… y {n} más", { n: s.hidden })}`] : []),
      ].join("\n"),
    ),
    `${t("Abrir Pizarro")}: ${baseUrl}`,
    `${optOut}\n${unsub.text}${noReply}`,
  ].join("\n\n") + "\n";

  const html = `<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;font-size:15px;color:#0f172a;max-width:600px">
<p>${escapeHtml(intro)}</p>
${digest.sections
  .map(
    (s) => `<h3 style="margin:20px 0 6px;font-size:15px">${escapeHtml(heading(s.key, t))} <span style="color:#64748b;font-weight:400">${s.total}</span></h3>
${s.projects
  .map(
    (p) => `<p style="margin:8px 0 2px;color:#64748b;font-size:13px">${escapeHtml(p.projectName)}</p>
<ul style="margin:0;padding-left:20px">${p.items.map((i) => `<li><a href="${escapeHtml(link(i))}" style="color:#4f46e5;text-decoration:none">${escapeHtml(itemText(i, t, s.key))}</a></li>`).join("")}</ul>`,
  )
  .join("\n")}${s.hidden ? `<p style="margin:4px 0;color:#64748b;font-size:13px">${escapeHtml(t("… y {n} más", { n: s.hidden }))}</p>` : ""}`,
  )
  .join("\n")}
<p style="margin-top:24px"><a href="${escapeHtml(baseUrl)}" style="display:inline-block;background:#4f46e5;color:#fff;padding:9px 16px;border-radius:8px;text-decoration:none">${escapeHtml(t("Abrir Pizarro"))}</a></p>
<p style="color:#64748b;font-size:12px">${escapeHtml(optOut)}<br>${escapeHtml(noReply)}${unsub.html}</p></div>`;
  return { subject, text, html };
}
