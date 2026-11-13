"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useT } from "@/i18n/client";
import { safeMarkdownUrl } from "@/lib/safe-url";
import { markdownComponents, markdownSource } from "./markdown-parts";

/**
 * Markdown seguro: react-markdown no interpreta HTML y las URLs pasan por una lista blanca propia. Para un texto que no
 * cambia en el navegador (páginas legales, licencia), StaticMarkdown: el mismo resultado sin enviar react-markdown.
 */
export function Markdown({ children }: { children: string }) {
  const t = useT();
  return (
    <div className="prose-md">
      <ReactMarkdown remarkPlugins={[remarkGfm]} urlTransform={safeMarkdownUrl} components={markdownComponents(t)}>
        {markdownSource(children)}
      </ReactMarkdown>
    </div>
  );
}
