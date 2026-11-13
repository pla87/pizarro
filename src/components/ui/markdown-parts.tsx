import type { Components } from "react-markdown";
import type { T } from "@/i18n/core";
import { UNDERLINE_HREF, underlineToLink } from "@/lib/markdown-underline";
import { mentionsToMarkdown } from "@/lib/mentions";

// Lo común del Markdown seguro que se pinta en el navegador (Markdown.tsx) y del que se pinta en el servidor
// (StaticMarkdown.tsx): mismos elementos y mismo texto de entrada. Sin "use client": lo importan los dos.

/** Elementos propios: subrayado, menciones, enlaces que abren aparte e imágenes solo de adjuntos de la app. */
export function markdownComponents(t: T): Components {
  return {
    a: ({ node: _node, href, children, ...props }) =>
      href === UNDERLINE_HREF ? (
        <u>{children}</u>
      ) : href?.startsWith("#mention-") ? (
        <span className="rounded bg-brand-50 px-1 font-medium text-brand-700 dark:bg-brand-500/15 dark:text-brand-100">{children}</span>
      ) : (
        <a {...props} href={href} target="_blank" rel="noopener noreferrer nofollow">
          {children}
        </a>
      ),
    img: ({ node: _node, alt, src }) =>
      typeof src === "string" && src.startsWith("/api/attachments/") ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img alt={alt ?? ""} src={src} loading="lazy" decoding="async" className="max-w-full rounded" />
      ) : (
        <span className="text-slate-400">{t("[imagen: {alt}]", { alt: alt ?? "" })}</span>
      ),
  };
}

/** Texto que recibe react-markdown: el subrayado y las menciones guardados, convertidos a enlaces especiales. */
export const markdownSource = (text: string): string => mentionsToMarkdown(underlineToLink(text));
