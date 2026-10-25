import { Marked } from "marked";
import { COPY_MARKER } from "./markdown-copy";
import { UNDERLINE_HREF, underlineToLink } from "./markdown-underline";
import { mentionsToMarkdown } from "./mentions";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/**
 * HTML de un Markdown de descripción para el portapapeles (Docs, Gmail…): negrita, listas, títulos, enlaces.
 * Sin HTML en bruto (se escapa); menciones como «@Nombre» en negrita; subrayado como <u>;
 * imágenes de adjuntos con ruta absoluta. El contenedor lleva COPY_MARKER para reconocerlo al pegar en Pizarro.
 */
export function markdownToHtml(markdown: string, origin = ""): string {
  const marked = new Marked({ gfm: true, breaks: false });
  marked.use({
    renderer: {
      html: ({ text }) => esc(text),
      link({ href, tokens }) {
        const inner = this.parser.parseInline(tokens);
        if (href === UNDERLINE_HREF) return `<u>${inner}</u>`;
        if (href.startsWith("#mention-")) return `<strong>${inner}</strong>`;
        return /^(https?:|mailto:|\/)/i.test(href) ? `<a href="${esc(href)}">${inner}</a>` : inner;
      },
      image: ({ href, text }) => (href.startsWith("/api/attachments/") ? `<img alt="${esc(text)}" src="${esc(origin + href)}">` : esc(text)),
    },
  });
  const body = marked.parse(mentionsToMarkdown(underlineToLink(markdown)), { async: false });
  return `<div ${COPY_MARKER}="1">${body}</div>`;
}
