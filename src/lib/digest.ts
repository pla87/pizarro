// Resumen diario por email: agrupación de lo ocurrido y texto del correo. Funciones puras (sin BD).
import type { T } from "../i18n/core";
import { escapeHtml, noReplyNote } from "./mail";
import { mentionsToPlain } from "./mentions";

export type DigestSectionKey = "assigned" | "overdue" | "dueToday" | "created" | "done" | "comments";

/** Orden en el que salen las secciones: primero lo que te toca a ti. */
const DIGEST_ORDER: DigestSectionKey[] = ["assigned", "overdue", "dueToday", "created", "done", "comments"];

/** Máximo de tareas por sección en el correo (el resto se resume en «y N más»). */
export const DIGEST_MAX_ITEMS = 25;

export interface DigestItem {
  taskId: string;
  title: string;
  projectId: string;
  projectName: string;
  /** Comentarios nuevos de la tarea (sección «comments»). */
  count?: number;
}

export type DigestInput = Record<DigestSectionKey, DigestItem[]>;

interface DigestSection {
  key: DigestSectionKey;
  /** Tareas de la sección (también las que no caben en el correo). */
  total: number;
  /** Las que se muestran, agrupadas por proyecto (orden alfabético). */
  projects: { projectId: string; projectName: string; items: DigestItem[] }[];
  /** Las que no caben. */
  hidden: number;
}

export function emptyDigestInput(): DigestInput {
  return { assigned: [], overdue: [], dueToday: [], created: [], done: [], comments: [] };
}

/**
 * Agrupa por sección y proyecto, sin repetir tareas dentro de una sección, y descarta las secciones vacías. `taskCount`:
 * tareas distintas entre todas las secciones (una tarea asignada, vencida y comentada cuenta una vez).
 */
export function buildDigest(input: DigestInput): { sections: DigestSection[]; empty: boolean; taskCount: number } {
  const sections: DigestSection[] = [];
  const all = new Set<string>();
  for (const key of DIGEST_ORDER) {
    const seen = new Set<string>();
    const unique = input[key].filter((i) => !seen.has(i.taskId) && !!seen.add(i.taskId));
    if (!unique.length) continue;
    for (const i of unique) all.add(i.taskId);
    const shown = unique.slice(0, DIGEST_MAX_ITEMS);
    const byProject = new Map<string, DigestSection["projects"][number]>();
    for (const item of shown) {
      const group = byProject.get(item.projectId) ?? { projectId: item.projectId, projectName: item.projectName, items: [] };
      group.items.push(item);
      byProject.set(item.projectId, group);
    }
    sections.push({
      key,
      total: unique.length,
      projects: [...byProject.values()].sort((a, b) => a.projectName.localeCompare(b.projectName)),
      hidden: unique.length - shown.length,
    });
  }
  return { sections, empty: sections.length === 0, taskCount: all.size };
}

function heading(key: DigestSectionKey, t: T): string {
  switch (key) {
    case "assigned": return t("Asignadas a ti");
    case "overdue": return t("Tus tareas vencidas");
    case "dueToday": return t("Tus tareas que vencen hoy");
    case "created": return t("Tareas nuevas");
    case "done": return t("Tareas completadas");
    default: return t("Comentarios nuevos");
  }
}

function itemText(i: DigestItem, t: T): string {
  const title = t("«{title}»", { title: mentionsToPlain(i.title) });
  return i.count && i.count > 1 ? `${title} (${t("{n} comentarios", { n: i.count })})` : title;
}

/**
 * Periodo que cubre el resumen (ver gatherDigest): desde el anterior, si fue hace como mucho 48 h; si fue antes, las
 * últimas 48 h; sin resumen anterior, las últimas 24 h.
 */
export type DigestPeriod = "sinceLast" | "48h" | "24h";

export function digestPeriod(lastSentAt: Date | null, now: Date): DigestPeriod {
  if (!lastSentAt) return "24h";
  return now.getTime() - lastSentAt.getTime() <= 2 * 24 * 60 * 60 * 1000 ? "sinceLast" : "48h";
}

/** Correo del resumen: asunto, texto plano y HTML (el contenido de los usuarios va escapado). */
export function digestEmail(digest: ReturnType<typeof buildDigest>, opts: { name: string; baseUrl: string; period?: DigestPeriod }, t: T) {
  const { baseUrl } = opts;
  const link = (i: DigestItem) => `${baseUrl}/p/${i.projectId}?task=${i.taskId}`;
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

  const text = [
    intro,
    ...digest.sections.map((s) =>
      [
        `${heading(s.key, t)} (${s.total})`,
        ...s.projects.flatMap((p) => [`  ${p.projectName}`, ...p.items.map((i) => `    - ${itemText(i, t)} ${link(i)}`)]),
        ...(s.hidden ? [`    ${t("… y {n} más", { n: s.hidden })}`] : []),
      ].join("\n"),
    ),
    `${t("Abrir Pizarro")}: ${baseUrl}`,
    `${optOut}\n${noReply}`,
  ].join("\n\n") + "\n";

  const html = `<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;font-size:15px;color:#0f172a;max-width:600px">
<p>${escapeHtml(intro)}</p>
${digest.sections
  .map(
    (s) => `<h3 style="margin:20px 0 6px;font-size:15px">${escapeHtml(heading(s.key, t))} <span style="color:#94a3b8;font-weight:400">${s.total}</span></h3>
${s.projects
  .map(
    (p) => `<p style="margin:8px 0 2px;color:#64748b;font-size:13px">${escapeHtml(p.projectName)}</p>
<ul style="margin:0;padding-left:20px">${p.items.map((i) => `<li><a href="${escapeHtml(link(i))}" style="color:#4f46e5;text-decoration:none">${escapeHtml(itemText(i, t))}</a></li>`).join("")}</ul>`,
  )
  .join("\n")}${s.hidden ? `<p style="margin:4px 0;color:#94a3b8;font-size:13px">${escapeHtml(t("… y {n} más", { n: s.hidden }))}</p>` : ""}`,
  )
  .join("\n")}
<p style="margin-top:24px"><a href="${escapeHtml(baseUrl)}" style="display:inline-block;background:#4f46e5;color:#fff;padding:9px 16px;border-radius:8px;text-decoration:none">${escapeHtml(t("Abrir Pizarro"))}</a></p>
<p style="color:#94a3b8;font-size:12px">${escapeHtml(optOut)}<br>${escapeHtml(noReply)}</p></div>`;
  return { subject, text, html };
}
