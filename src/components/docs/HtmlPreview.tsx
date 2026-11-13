"use client";

import { useMemo } from "react";

/**
 * Política del propio documento: nada de la red (ni scripts, ni hojas de estilo, ni imágenes externas, que avisarían a un
 * tercero de quién lo abre); solo estilos en línea e imágenes y fuentes incrustadas (data:).
 */
const FRAME_CSP = "default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; media-src data:; form-action 'none'";

/** Atributos con URL que podrían llevar `javascript:`. */
const URL_ATTRS = ["href", "src", "action", "formaction", "xlink:href"];

/**
 * HTML de un documento de Documentación listo para el `srcdoc` del marco aislado. Se lee con DOMParser (que no ejecuta
 * nada) y se quitan scripts, marcos, objetos, `<base>`, `<meta http-equiv>` y manejadores `on…`, aunque el marco ya no
 * permite scripts: así no depende de una sola barrera. Se añade la CSP del documento y `<base target="_blank">` para que
 * los enlaces se abran en otra pestaña (sin acceso a esta: `noopener noreferrer`); los enlaces internos (#…), en el marco.
 */
function htmlPreviewDocument(html: string): string {
  const doc = new DOMParser().parseFromString(html, "text/html");
  doc.querySelectorAll("script, iframe, frame, frameset, object, embed, applet, portal, base, meta[http-equiv], link[rel~='import' i]").forEach((n) => n.remove());
  for (const el of Array.from(doc.querySelectorAll("*"))) {
    for (const attr of Array.from(el.attributes)) {
      const name = attr.name.toLowerCase();
      // `ping`: al seguir un enlace avisaría a otra dirección (fuera de la CSP del marco).
      if (name.startsWith("on") || name === "ping" || (URL_ATTRS.includes(name) && /^\s*(?:javascript:|vbscript:|data:text\/html)/i.test(attr.value.replace(/[\u0000-\u001f]/g, "")))) el.removeAttribute(attr.name);
    }
    // Enlaces de HTML y de SVG (en SVG el nombre va en minúsculas y la dirección puede ir en xlink:href).
    if (el.localName === "a" || el.localName === "area") {
      const attr = el.hasAttribute("href") ? "href" : el.hasAttribute("xlink:href") ? "xlink:href" : null;
      if (!attr) continue;
      const href = el.getAttribute(attr)!.trim();
      if (href.startsWith("#")) {
        // Internos (índice, notas): en el propio marco. La dirección base de un `srcdoc` es la de la página de la app,
        // así que «#tema» llevaba al marco la página de la app (que no se deja enmarcar: quedaba un error). Con
        // «about:srcdoc#tema» solo se desplaza dentro del documento.
        el.setAttribute(attr, `about:srcdoc${href}`);
        el.setAttribute("target", "_self");
      }
      el.setAttribute("rel", "noopener noreferrer");
    }
  }
  const csp = doc.createElement("meta");
  csp.setAttribute("http-equiv", "Content-Security-Policy");
  csp.setAttribute("content", FRAME_CSP);
  const referrer = doc.createElement("meta");
  referrer.setAttribute("name", "referrer");
  referrer.setAttribute("content", "no-referrer");
  const base = doc.createElement("base");
  base.setAttribute("target", "_blank");
  doc.head.prepend(csp, referrer, base);
  return `<!doctype html>\n${doc.documentElement.outerHTML}`;
}

/**
 * Vista previa de un documento HTML: en un `<iframe sandbox>` sin `allow-scripts` ni `allow-same-origin` (origen opaco:
 * ni ejecuta scripts ni puede leer cookies, almacenamiento o páginas de la app), con el HTML en `srcdoc` (el servidor
 * nunca lo sirve como HTML) y una CSP propia sin red. Solo se permite abrir enlaces en otra pestaña.
 */
export function HtmlPreview({ html, title }: { html: string; title: string }) {
  const srcDoc = useMemo(() => htmlPreviewDocument(html), [html]);
  return (
    <iframe
      sandbox="allow-popups allow-popups-to-escape-sandbox"
      srcDoc={srcDoc}
      title={title}
      referrerPolicy="no-referrer"
      data-testid="doc-html"
      className="h-[70vh] w-full rounded border border-slate-200 bg-white dark:border-slate-700"
    />
  );
}
