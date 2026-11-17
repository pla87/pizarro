"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useT } from "@/i18n/client";
import { rehypeHeadingIds } from "@/lib/heading-ids";
import { safeMarkdownUrl } from "@/lib/safe-url";
import { markdownComponents, markdownSource } from "./markdown-parts";

/**
 * Markdown seguro: react-markdown no interpreta HTML y las URLs pasan por una lista blanca propia. Para un texto que no
 * cambia en el navegador (páginas legales, licencia), StaticMarkdown: el mismo resultado sin enviar react-markdown.
 */
const HEADING_IDS = [rehypeHeadingIds];

/** `headingIds`: cada título lleva su `id` (heading-ids.ts), para llegar a un «#apartado» (visor de la Documentación). */
export function Markdown({ children, headingIds = false }: { children: string; headingIds?: boolean }) {
  const t = useT();
  return (
    <div className="prose-md">
      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={headingIds ? HEADING_IDS : undefined} urlTransform={safeMarkdownUrl} components={markdownComponents(t)}>
        {markdownSource(children)}
      </ReactMarkdown>
    </div>
  );
}
