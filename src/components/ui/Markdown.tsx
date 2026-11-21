"use client";

import { useMemo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useT } from "@/i18n/client";
import { rehypeHeadingIds } from "@/lib/heading-ids";
import { safeMarkdownUrl } from "@/lib/safe-url";
import { rehypeSearchHighlight } from "@/lib/search-highlight";
import { markdownComponents, markdownSource } from "./markdown-parts";
import { rehypeEmailSafe } from "./EmailSafe";

/**
 * Markdown seguro: react-markdown no interpreta HTML y las URLs pasan por una lista blanca propia. Para un texto que no
 * cambia en el navegador (páginas legales, licencia), StaticMarkdown: el mismo resultado sin enviar react-markdown.
 */
const PLUGINS = [rehypeEmailSafe];
const HEADING_IDS = [rehypeEmailSafe, rehypeHeadingIds];

/**
 * `headingIds`: cada título lleva su `id` (heading-ids.ts), para llegar a un «#apartado» (visor de la Documentación).
 * `highlight`: lo buscado, resaltado en los nodos de texto (search-highlight.ts; antes de rehypeEmailSafe, que parte los
 * emails en varios nodos).
 */
export function Markdown({ children, headingIds = false, highlight = "" }: { children: string; headingIds?: boolean; highlight?: string }) {
  const t = useT();
  const plugins = useMemo(() => {
    const base = headingIds ? HEADING_IDS : PLUGINS;
    return highlight ? [() => rehypeSearchHighlight(highlight), ...base] : base;
  }, [headingIds, highlight]);
  return (
    <div className="prose-md">
      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={plugins} urlTransform={safeMarkdownUrl} components={markdownComponents(t)}>
        {markdownSource(children)}
      </ReactMarkdown>
    </div>
  );
}
