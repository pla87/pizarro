import { escapeHtml } from "@/lib/html-escape";

// Texto con emails que llega ya pintado en el HTML del servidor. Un proxy delante de Pizarro puede reescribir los emails
// del HTML antes de que llegue al navegador (Cloudflare, «Email Address Obfuscation»: cambia «ana@example.com» por un
// enlace «[email protected]» y lo descodifica después con su script). React encuentra entonces otro HTML del que pintó el
// servidor y da el error de hidratación #418 en cada carga (Mi perfil, Administración → Usuarios). Aquí el texto va en
// `dangerouslySetInnerHTML` (React no compara su contenido al hidratar), entre las marcas <!--email_off--> que Cloudflare
// respeta, y la «@» en su propio elemento, para que tampoco lo reconozca como email otro proxy que no conozca esas marcas.

/** Texto (con o sin emails) a salvo de los proxies que reescriben los emails del HTML. Sin "use client": vale en los dos lados. */
export function EmailSafe({ text, className }: { text: string; className?: string }) {
  const html = escapeHtml(text).replace(/@/g, "<span>@</span>");
  return <span className={className} dangerouslySetInnerHTML={{ __html: `<!--email_off-->${html}<!--/email_off-->` }} />;
}

interface HastNode {
  type: string;
  tagName?: string;
  value?: string;
  properties?: Record<string, unknown>;
  children?: HastNode[];
}

// Sin «lookbehind» (Safari antiguo): la letra de antes de la «@» entra en la coincidencia.
const EMAIL_AT = /[\w.+-]@(?=[\w-]+\.[\w-])/;

/**
 * Plugin de rehype (Markdown y StaticMarkdown): la «@» de cada email del texto va en su propio <span>, así que en el HTML
 * ningún nodo de texto es un email y un proxy no lo reescribe (mismo motivo que EmailSafe). Se ve y se copia igual.
 */
export function rehypeEmailSafe() {
  const split = (node: HastNode): HastNode[] => {
    const value = node.value ?? "";
    const out: HastNode[] = [];
    let rest = value;
    for (let m = EMAIL_AT.exec(rest); m; m = EMAIL_AT.exec(rest)) {
      out.push({ type: "text", value: rest.slice(0, m.index + 1) }, { type: "element", tagName: "span", properties: {}, children: [{ type: "text", value: "@" }] });
      rest = rest.slice(m.index + 2);
    }
    if (!out.length) return [node];
    out.push({ type: "text", value: rest });
    return out;
  };
  return (tree: HastNode) => {
    const walk = (node: HastNode) => {
      if (!node.children) return;
      node.children = node.children.flatMap((c) => (c.type === "text" && c.value?.includes("@") ? split(c) : (walk(c), [c])));
    };
    walk(tree);
  };
}
