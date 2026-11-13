import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { T } from "@/i18n/core";
import { safeMarkdownUrl } from "@/lib/safe-url";
import { markdownComponents, markdownSource } from "./markdown-parts";

/**
 * Markdown seguro pintado en el servidor (componente de servidor): el mismo HTML que <Markdown>, pero react-markdown,
 * remark y sus dependencias (~44 KB comprimidos) no llegan al navegador. Para textos que no cambian en la página:
 * política de privacidad, condiciones y licencia (páginas públicas que se abren sin sesión, a menudo desde el móvil).
 */
export function StaticMarkdown({ children, t }: { children: string; t: T }) {
  return (
    <div className="prose-md">
      <ReactMarkdown remarkPlugins={[remarkGfm]} urlTransform={safeMarkdownUrl} components={markdownComponents(t)}>
        {markdownSource(children)}
      </ReactMarkdown>
    </div>
  );
}
