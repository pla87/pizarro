"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/** Markdown seguro: react-markdown no interpreta HTML y filtra URLs peligrosas. */
export function Markdown({ children }: { children: string }) {
  return (
    <div className="prose-md">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ node: _node, ...props }) => <a {...props} target="_blank" rel="noopener noreferrer nofollow" />,
          img: ({ node: _node, alt, src }) =>
            typeof src === "string" && src.startsWith("/api/attachments/") ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img alt={alt ?? ""} src={src} className="max-w-full rounded" />
            ) : (
              <span className="text-slate-400">[imagen: {alt}]</span>
            ),
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
