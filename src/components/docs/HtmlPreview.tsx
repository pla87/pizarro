"use client";

import { useMemo, useRef } from "react";
import { classifyHtmlLink } from "@/lib/html-doc-links";
import { useT } from "@/i18n/client";

/**
 * Política del propio documento: nada de la red (ni scripts, ni hojas de estilo, ni imágenes externas, que avisarían a un
 * tercero de quién lo abre); solo estilos en línea e imágenes y fuentes incrustadas (data:).
 */
const FRAME_CSP = "default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; media-src data:; form-action 'none'";

/** Atributos con URL que podrían llevar `javascript:`. */
const URL_ATTRS = ["href", "src", "action", "formaction", "xlink:href"];

/**
 * HTML de un documento de Documentación listo para el `srcdoc` del marco aislado. Se lee con DOMParser (que no ejecuta
 * nada) y se quitan scripts, marcos, objetos, `<base>`, `<meta http-equiv>`, todos los `<link>` y `<template>` y los manejadores `on…`,
 * aunque el marco ya no permite scripts: así no depende de una sola barrera. Se añade la CSP del documento y `<base target="_blank">` para que
 * los enlaces se abran en otra pestaña (sin acceso a esta: `noopener noreferrer`); los enlaces internos (#…), en el marco.
 * Los relativos a otro fichero se resuelven contra los documentos de la MISMA Documentación (classifyHtmlLink): si existe,
 * el enlace pasa a ser la dirección del visor de la app para ese documento; si no, queda desactivado con su title.
 */
function htmlPreviewDocument(html: string, links: { projectId: string; docs: readonly { id: string; name: string }[]; missingTitle: string }): string {
  const doc = new DOMParser().parseFromString(html, "text/html");
  // Todos los <link>: las hojas de estilo externas ya las bloquea la CSP, pero dns-prefetch, preconnect, prefetch,
  // prerender o modulepreload pueden tocar la red (o resolver un nombre) antes de que se aplique o fuera de ella y avisar a
  // un tercero de que alguien lo ha abierto. Ninguno hace falta para ver el documento.
  // Y todos los <template>: DOMParser no monta el shadow DOM declarativo (<template shadowrootmode>), así que su contenido
  // no se recorre aquí; el marco, en cambio, sí lo monta al leer el srcdoc, con lo que dentro llegaban vivos <link
  // rel=preconnect>, `on…`, `ping` y enlaces sin resolver. Un <template> nunca se ve: quitarlo no pierde nada visible.
  doc.querySelectorAll("script, iframe, frame, frameset, object, embed, applet, portal, base, meta[http-equiv], link, template").forEach((n) => n.remove());
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
      const link = classifyHtmlLink(href, links.docs);
      if (link.type === "document") {
        // Otro documento de ESTA Documentación (la lista solo trae los del proyecto): se abre en el visor de la app, en otra
        // pestaña, sin que el marco gane ningún permiso (no puede avisar al padre sin scripts). La dirección la construye la
        // app con el id que ha resuelto ella; nada del `href` original llega al enlace salvo el apartado, normalizado.
        el.setAttribute(attr, `/p/${encodeURIComponent(links.projectId)}/docs?doc=${encodeURIComponent(link.id)}${link.hash}`);
        el.setAttribute("target", "_blank");
      } else if (link.type === "missing") {
        // Enlace a un fichero que no está en la Documentación: sin dirección, no navega a ninguna parte.
        el.removeAttribute(attr);
        el.removeAttribute("target");
        el.setAttribute("title", links.missingTitle);
        el.setAttribute("aria-disabled", "true");
        el.setAttribute("data-pz-disabled", "");
      } else if (link.type === "internal") {
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
  // Sin resolver de antemano los nombres de los enlaces del documento.
  const dnsPrefetch = doc.createElement("meta");
  dnsPrefetch.setAttribute("http-equiv", "x-dns-prefetch-control");
  dnsPrefetch.setAttribute("content", "off");
  const referrer = doc.createElement("meta");
  referrer.setAttribute("name", "referrer");
  referrer.setAttribute("content", "no-referrer");
  const disabledCss = doc.createElement("style");
  disabledCss.textContent = "a[data-pz-disabled]{cursor:not-allowed;opacity:.6}";
  const base = doc.createElement("base");
  base.setAttribute("target", "_blank");
  doc.head.prepend(csp, dnsPrefetch, referrer, base, disabledCss);
  return `<!doctype html>\n${doc.documentElement.outerHTML}`;
}

/**
 * Vista previa de un documento HTML: en un `<iframe sandbox>` sin `allow-scripts` ni `allow-same-origin` (origen opaco:
 * ni ejecuta scripts ni puede leer cookies, almacenamiento o páginas de la app), con el HTML en `srcdoc` (el servidor
 * nunca lo sirve como HTML) y una CSP propia sin red. Solo se permite abrir enlaces en otra pestaña.
 */
export function HtmlPreview({ html, title, projectId, docs, fromLink }: { html: string; title: string; projectId: string; docs: readonly { id: string; name: string }[]; fromLink?: boolean }) {
  const t = useT();
  const missingTitle = t("Enlace a otro archivo que no está en la Documentación");
  const srcDoc = useMemo(() => htmlPreviewDocument(html, { projectId, docs, missingTitle }), [html, projectId, docs, missingTitle]);
  const frame = useRef<HTMLIFrameElement>(null);
  // Una sola vez por documento: llevar el marco a «about:srcdoc#apartado» lo recarga (y volvería a disparar «load»).
  const scrolled = useRef(false);
  return (
    <iframe
      ref={frame}
      sandbox="allow-popups allow-popups-to-escape-sandbox"
      srcDoc={srcDoc}
      title={title}
      referrerPolicy="no-referrer"
      data-testid="doc-html"
      // Al llegar por un enlace «otro.html#apartado»: el padre (que sí puede navegar su marco) lleva el marco al apartado.
      onLoad={() => {
        const anchor = fromLink && !scrolled.current ? window.location.hash : "";
        if (/^#[^\s]+$/.test(anchor)) {
          scrolled.current = true;
          try { frame.current?.contentWindow?.location.replace(`about:srcdoc${anchor}`); } catch { /* sin apartado: se queda arriba */ }
        }
      }}
      className="h-[70vh] w-full rounded border border-slate-200 bg-white dark:border-slate-700"
    />
  );
}
