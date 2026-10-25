"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useT } from "@/i18n/client";
import { UNDERLINE_HREF, underlineToLink } from "@/lib/markdown-underline";
import { mentionsToMarkdown } from "@/lib/mentions";
import { safeMarkdownUrl } from "@/lib/safe-url";

/** Markdown seguro: react-markdown no interpreta HTML y las URLs pasan por una lista blanca propia. */
export function Markdown({ children }: { children: string }) {
  const t = useT();
  return (
    <div className="prose-md">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        urlTransform={safeMarkdownUrl}
        components={{
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
              <img alt={alt ?? ""} src={src} className="max-w-full rounded" />
            ) : (
              <span className="text-slate-400">{t("[imagen: {alt}]", { alt: alt ?? "" })}</span>
            ),
        }}
      >
        {mentionsToMarkdown(underlineToLink(children))}
      </ReactMarkdown>
    </div>
  );
}
