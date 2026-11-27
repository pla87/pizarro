import { Marked } from "marked";
import { escapeHtml } from "./html-escape";
import { formatSize } from "./format-size";
import { withoutEmptyFormSections } from "./form-sections";
import { mentionsToPlain } from "./mentions";
import { UNDERLINE_HREF, underlineToLink } from "./markdown-underline";
import { MAX_SHARE_COMMENT, type ShareNotice } from "./share-out-core";
import type { T } from "../i18n/core";

// Página pública de «Compartir fuera» (/x/<token>): HTML mínimo hecho en el servidor, sin el AppShell ni JavaScript (los
// cambios son formularios POST normales). Puro: recibe los datos ya leídos (share-out.ts) y el traductor. Todo lo que
// viene de las tareas se escapa; la descripción y los comentarios pasan por un Markdown sin HTML en bruto en el que las
// imágenes de adjuntos apuntan a la ruta de descarga de la página, las menciones quedan en texto plano y los enlaces
// internos de Pizarro (relativos o a la propia instalación) se quitan dejando su texto.

/** Lo que la página necesita de cada tarea publicada. */
interface SharePageTask {
  id: string;
  title: string;
  description: string;
  dueDate: string | null;
  /** Responsable por su nombre de pila o nombre visible (nunca su email). */
  assignee: string | null;
  done: boolean;
  subtasks: { title: string; done: boolean }[];
  attachments: { id: string; name: string; size: number; isImage: boolean }[];
  /** Los últimos comentarios (como mucho MAX_SHARE_PAGE_COMMENTS), del más antiguo al más reciente. */
  comments: { author: string; body: string; createdAt: string }[];
  /** Comentarios anteriores que no se publican. */
  olderComments?: number;
}

export interface SharePageData {
  token: string;
  columnName: string;
  tasks: SharePageTask[];
  /** Hay una columna «terminada» a la que mandar las tareas: sale «Marcar como hecha». */
  canMarkDone: boolean;
  /** Hasta cuándo vale el enlace si no se usa (ISO), para el pie. */
  expiresAt: string;
  /** Aviso tras un formulario (`?m=`). */
  notice: ShareNotice | null;
  /** Tarea a la que se refiere el aviso (`?t=`, solo si sigue en la lista): sale en su tarjeta, no arriba del todo. */
  noticeTaskId?: string | null;
  /** Nombre de pila de quien generó la web (de su cuenta); null si ya no existe. */
  sharedBy?: string | null;
  /** Región BCP 47 de las fechas (es-ES, en-GB…). */
  locale: string;
  lang: "es" | "en";
  timeZone: string;
  /** Origen de la instalación (APP_URL): sus enlaces se tratan como internos. */
  appOrigin: string | null;
}

/**
 * Dirección de un adjunto de la tarea servido por la página (descarga; `inline` para las imágenes de la descripción;
 * `"thumb"`, la miniatura de un adjunto, que se ve en línea y no cuenta como descarga).
 */
export const shareAttachmentPath = (token: string, attachmentId: string, inline: boolean | "thumb" = false): string =>
  `/x/${encodeURIComponent(token)}/a/${encodeURIComponent(attachmentId)}${inline === "thumb" ? "?inline=thumb" : inline ? "?inline=1" : ""}`;

const ATTACHMENT_SRC = /^\/api\/attachments\/([A-Za-z0-9_-]{1,40})(?:\?[^#\s]*)?$/;

/** ¿Lleva a algún sitio de la propia instalación (relativo, ancla o con su mismo origen)? */
function internalHref(href: string, appOrigin: string | null): boolean {
  const h = href.trim();
  if (!/^[a-z][a-z0-9+.-]*:/i.test(h)) return true;
  if (!appOrigin) return false;
  try {
    return new URL(h).origin === new URL(appOrigin).origin;
  } catch {
    return true;
  }
}

/**
 * Markdown de una descripción o un comentario a HTML seguro para la página. `attachments`: ids de los adjuntos de ESA
 * tarea; una imagen o un enlace a otro adjunto (de otra tarea) se queda en su texto. Sin HTML en bruto.
 */
export function shareMarkdownHtml(markdown: string, opts: { token: string; attachments: ReadonlySet<string>; appOrigin: string | null }): string {
  const marked = new Marked({ gfm: true, breaks: true });
  const own = (href: string): string | null => {
    const m = ATTACHMENT_SRC.exec(href.trim());
    return m && opts.attachments.has(m[1]!) ? m[1]! : null;
  };
  marked.use({
    renderer: {
      html: ({ text }) => escapeHtml(text),
      link({ href, tokens }) {
        const inner = this.parser.parseInline(tokens);
        if (href === UNDERLINE_HREF) return `<u>${inner}</u>`;
        const id = own(href);
        if (id) return `<a href="${escapeHtml(shareAttachmentPath(opts.token, id))}">${inner}</a>`;
        // Interno: solo su texto; si el texto es la propia dirección (un enlace escrito tal cual), nada.
        if (internalHref(href, opts.appOrigin)) return inner.trim() === escapeHtml(href.trim()) ? "" : inner;
        if (!/^(https?:|mailto:|tel:)/i.test(href.trim())) return inner;
        return `<a href="${escapeHtml(href.trim())}" rel="noopener noreferrer nofollow" target="_blank">${inner}</a>`;
      },
      image({ href, text }) {
        const id = own(href);
        if (!id) return escapeHtml(text);
        const src = escapeHtml(shareAttachmentPath(opts.token, id, true));
        return `<a href="${escapeHtml(shareAttachmentPath(opts.token, id))}"><img alt="${escapeHtml(text)}" src="${src}" loading="lazy"></a>`;
      },
    },
  });
  return marked.parse(mentionsToPlain(underlineToLink(markdown)), { async: false });
}

const CSS = `
:root{color-scheme:light dark;--bg:#f8fafc;--card:#fff;--text:#0f172a;--muted:#64748b;--line:#e2e8f0;--brand:#4f46e5;--btn:#4f46e5;--ok:#15803d;--warn:#b45309}
@media (prefers-color-scheme:dark){:root{--bg:#0b1120;--card:#111827;--text:#e2e8f0;--muted:#94a3b8;--line:#1f2937;--brand:#a5b4fc;--btn:#4f46e5;--ok:#4ade80;--warn:#fbbf24}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:15px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
main{max-width:760px;margin:0 auto;padding:16px}h1{font-size:1.35rem;margin:8px 0 4px}h2{font-size:1.1rem;margin:0}
.muted{color:var(--muted);font-size:.85rem}.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:16px;margin:14px 0}
.head{display:flex;flex-wrap:wrap;gap:8px;align-items:baseline;justify-content:space-between}.badge{font-size:.75rem;font-weight:600;border-radius:999px;padding:2px 8px;border:1px solid currentColor}
.done{color:var(--ok)}.notice{border-left:4px solid var(--brand);padding:8px 12px;background:var(--card);border-radius:8px;margin:12px 0}.notice.err{border-color:var(--warn)}
.desc img{display:block;max-width:100%;height:auto;margin:10px 0;border-radius:6px}.desc{overflow-wrap:anywhere}ul.sub{list-style:none;padding:0;margin:6px 0}ul.sub li{margin:2px 0}
ul.files{padding-left:18px;margin:6px 0}ul.files li.img{list-style:none;margin-left:-18px;margin-bottom:8px}ul.files li.img img{display:block;max-width:200px;max-height:140px;width:auto;height:auto;border:1px solid var(--line);border-radius:6px;margin-bottom:2px}.by{margin:0}a{color:var(--brand)}form{margin:8px 0 0}.row{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
input,textarea,button{font:inherit;color:inherit}input[type=date],textarea{background:var(--bg);border:1px solid var(--line);border-radius:8px;padding:6px 8px}
textarea{width:100%;min-height:70px}button{background:var(--btn);color:#fff;border:0;border-radius:8px;padding:7px 14px;cursor:pointer}
button.secondary{background:transparent;color:var(--brand);border:1px solid var(--brand)}.comment{border-top:1px solid var(--line);padding-top:8px;margin-top:8px}
h3{font-size:.85rem;margin:14px 0 4px;color:var(--muted);text-transform:uppercase;letter-spacing:.03em}
`;

/** Documento HTML completo (con las metas de no indexar). */
function documentHtml(lang: string, title: string, body: string): string {
  return `<!doctype html><html lang="${escapeHtml(lang)}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><meta name="referrer" content="no-referrer"><title>${escapeHtml(title)}</title><style>${CSS}</style></head><body><main>${body}</main></body></html>`;
}

function noticeText(n: ShareNotice, t: T): { text: string; error: boolean } {
  switch (n) {
    case "done": return { text: t("Tarea marcada como hecha."), error: false };
    case "due": return { text: t("Fecha cambiada."), error: false };
    case "comment": return { text: t("Comentario publicado."), error: false };
    case "rate": return { text: t("Demasiados cambios seguidos. Espera un rato y vuelve a intentarlo."), error: true };
    case "full": return { text: t("Esta tarea ya no admite más comentarios."), error: true };
    case "gone": return { text: t("Esa tarea ya no está en esta lista."), error: true };
    default: return { text: t("No se ha podido guardar: revisa los datos."), error: true };
  }
}

const noticeHtml = (n: { text: string; error: boolean }): string => `<p class="notice${n.error ? " err" : ""}" role="status">${escapeHtml(n.text)}</p>`;

const day = (iso: string, locale: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString(locale, { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

/**
 * Día del pie («deja de funcionar si nadie lo usa hasta el…»): el de la zona horaria de la instalación, no el de UTC (en
 * una instalación de América, un enlace que caduca de noche decía un día de más).
 */
export const shareExpiryDay = (iso: string, locale: string, timeZone: string): string =>
  new Date(iso).toLocaleDateString(locale, { day: "numeric", month: "long", year: "numeric", timeZone });

/** La página con las tareas publicadas. */
export function sharePageHtml(d: SharePageData, t: T): string {
  const md = (text: string, attachments: ReadonlySet<string>) => shareMarkdownHtml(text, { token: d.token, attachments, appOrigin: d.appOrigin });
  const when = (iso: string) => new Date(iso).toLocaleString(d.locale, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: d.timeZone });
  const action = (taskId: string) => `/x/${encodeURIComponent(d.token)}/t/${encodeURIComponent(taskId)}`;
  const notice = d.notice ? noticeText(d.notice, t) : null;
  const tasks = d.tasks.map((task) => {
    const ids = new Set(task.attachments.map((a) => a.id));
    const title = escapeHtml(mentionsToPlain(task.title));
    const parts: string[] = [];
    // Los botones se repiten en cada tarea: el título de la suya (aria-describedby) dice a un lector de pantalla cuál es.
    const headId = `h-${escapeHtml(task.id)}`;
    const of = ` aria-describedby="${headId}"`;
    parts.push(`<div class="head"><h2 id="${headId}">${title}</h2>${task.done ? `<span class="badge done">${escapeHtml(t("Hecha"))}</span>` : ""}</div>`);
    const meta = [
      task.dueDate ? t("Fecha: {date}", { date: day(task.dueDate, d.locale) }) : t("Sin fecha"),
      task.assignee ? t("Responsable: {name}", { name: task.assignee }) : null,
    ].filter(Boolean).map((s) => escapeHtml(s!)).join(" · ");
    parts.push(`<p class="muted">${meta}</p>`);
    // Sin los apartados vacíos de la plantilla del tipo («**Por qué:**» sin respuesta): como en el plan para IA.
    const description = withoutEmptyFormSections(task.description.split(/\r\n|\r|\n/)).join("\n");
    if (description.trim()) parts.push(`<div class="desc">${md(description, ids)}</div>`);
    if (task.subtasks.length) {
      parts.push(`<h3>${escapeHtml(t("Subtareas"))}</h3><ul class="sub">${task.subtasks.map((s) => `<li>${s.done ? "☑" : "☐"} ${escapeHtml(mentionsToPlain(s.title))}</li>`).join("")}</ul>`);
    }
    if (task.attachments.length) {
      // Las imágenes, con su miniatura (servida en línea, que no cuenta como descarga); tanto la miniatura como el nombre enlazan a la descarga.
      const file = (a: SharePageTask["attachments"][number]) => `<a href="${escapeHtml(shareAttachmentPath(d.token, a.id))}">${escapeHtml(a.name)}</a> <span class="muted">(${escapeHtml(formatSize(a.size, d.locale))})</span>`;
      const item = (a: SharePageTask["attachments"][number]) => a.isImage
        ? `<li class="img"><a href="${escapeHtml(shareAttachmentPath(d.token, a.id))}"><img src="${escapeHtml(shareAttachmentPath(d.token, a.id, "thumb"))}" alt="${escapeHtml(a.name)}" loading="lazy"></a>${file(a)}</li>`
        : `<li>${file(a)}</li>`;
      parts.push(`<h3>${escapeHtml(t("Adjuntos"))}</h3><ul class="files">${task.attachments.map(item).join("")}</ul>`);
    }
    const forms: string[] = [];
    if (d.canMarkDone && !task.done) {
      forms.push(`<form method="post" action="${action(task.id)}"><input type="hidden" name="op" value="done"><button type="submit"${of}>${escapeHtml(t("Marcar como hecha"))}</button></form>`);
    }
    forms.push(`<form method="post" action="${action(task.id)}" class="row"><input type="hidden" name="op" value="due"><label class="row">${escapeHtml(t("Fecha"))} <input type="date" name="due" value="${escapeHtml(task.dueDate ?? "")}"></label><button type="submit" class="secondary"${of}>${escapeHtml(t("Cambiar fecha"))}</button></form>`);
    parts.push(forms.join(""));
    parts.push(`<h3>${escapeHtml(t("Comentarios"))}</h3>`);
    if (!task.comments.length) parts.push(`<p class="muted">${escapeHtml(t("Aún no hay comentarios."))}</p>`);
    const older = task.olderComments ?? 0;
    if (older) parts.push(`<p class="muted">${escapeHtml(older === 1 ? t("Hay 1 comentario anterior que no se muestra.") : t("Hay {n} comentarios anteriores que no se muestran.", { n: older }))}</p>`);
    for (const c of task.comments) {
      parts.push(`<div class="comment"><p class="muted">${escapeHtml(c.author)} · ${escapeHtml(when(c.createdAt))}</p><div class="desc">${md(c.body, ids)}</div></div>`);
    }
    parts.push(`<form method="post" action="${action(task.id)}"><input type="hidden" name="op" value="comment"><textarea name="body" required maxlength="${MAX_SHARE_COMMENT}" aria-label="${escapeHtml(t("Comentario"))}" placeholder="${escapeHtml(t("Escribe un comentario…"))}"></textarea><button type="submit"${of}>${escapeHtml(t("Comentar"))}</button></form>`);
    // El aviso de lo que se acaba de hacer sale en la tarjeta de su tarea (la página vuelve a ella), no arriba del todo.
    const here = notice && d.noticeTaskId === task.id ? noticeHtml(notice) : "";
    return `<section class="card" id="t-${escapeHtml(task.id)}">${here}${parts.join("")}</section>`;
  });
  const body = [
    `<h1>${escapeHtml(d.columnName)}</h1>`,
    `<p class="muted by">${escapeHtml(d.sharedBy ? t("Compartida por {name} desde Pizarro", { name: d.sharedBy }) : t("Compartida desde Pizarro"))}</p>`,
    `<p class="muted">${escapeHtml(d.tasks.length === 1 ? t("1 tarea") : t("{n} tareas", { n: d.tasks.length }))}</p>`,
    notice && !d.noticeTaskId ? noticeHtml(notice) : "",
    d.tasks.length ? tasks.join("") : `<p class="card muted">${escapeHtml(t("No hay tareas en esta lista."))}</p>`,
    `<p class="muted">${escapeHtml(t("Este enlace deja de funcionar si nadie lo usa hasta el {date}.", { date: shareExpiryDay(d.expiresAt, d.locale, d.timeZone) }))}</p>`,
  ].join("");
  return documentHtml(d.lang, d.columnName, body);
}

/** «Ha caducado» (los 30 días tras caducar o revocarse) y «no encontrado» (después, o un enlace que nunca existió). */
export function shareMessageHtml(kind: "expired" | "revoked" | "notFound" | "rate", lang: "es" | "en", t: T): string {
  if (kind === "revoked") return documentHtml(lang, t("Enlace no disponible"), `<div class="card"><h1>${escapeHtml(t("Enlace no disponible"))}</h1><p>${escapeHtml(t("Esta lista de tareas ya no está disponible. Contacta con la persona que te ha dado el enlace."))}</p></div>`);
  if (kind === "expired") return documentHtml(lang, t("Enlace caducado"), `<div class="card"><h1>${escapeHtml(t("Enlace caducado"))}</h1><p>${escapeHtml(t("Esta lista de tareas ha caducado. Contacta con la persona que te ha dado el enlace."))}</p></div>`);
  if (kind === "rate") return documentHtml(lang, t("Demasiados intentos"), `<div class="card"><p>${escapeHtml(t("Demasiados intentos. Espera unos minutos."))}</p></div>`);
  return documentHtml(lang, t("No encontrado"), `<div class="card"><h1>${escapeHtml(t("No encontrado"))}</h1><p>${escapeHtml(t("La página no existe o no tienes acceso."))}</p></div>`);
}
