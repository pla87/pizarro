// Content-Length de las descargas en flujo (solo runtime Node; lo instala instrumentation.ts al arrancar).
//
// Next quita el Content-Length de la respuesta de una ruta al copiarla a la de Node (FORBIDDEN_HEADERS en
// next/dist/server/send-response.js: el cuerpo de un fetch puede llegar ya descomprimido y esa cabecera ya no valdría), y
// la respuesta sale con «Transfer-Encoding: chunked». Sin el tamaño, el navegador no puede enseñar el progreso ni el
// tiempo que queda de una descarga larga (los ZIP de adjuntos). Una ruta que conoce el tamaño exacto de lo que envía
// lo pone en DECLARED_LENGTH_HEADER, y aquí, al escribir las cabeceras, pasa a ser el Content-Length de verdad.
//
// El mismo gancho añade «no-transform» al Cache-Control de las páginas HTML (ver html-no-transform.ts).

import http from "node:http";
import https from "node:https";
import { applyHtmlNoTransform } from "./html-no-transform";

/** Cabecera interna con el tamaño exacto del cuerpo; no sale al cliente. */
export const DECLARED_LENGTH_HEADER = "x-pz-content-length";
const MARK = Symbol.for("pizarro.declaredLength");

type HeaderTarget = Pick<http.ServerResponse, "getHeader" | "removeHeader" | "setHeader" | "hasHeader">;

/** Cambia la cabecera interna por Content-Length (si es un número y nadie ha puesto otra codificación del cuerpo). */
export function applyDeclaredLength(res: HeaderTarget): void {
  const declared = res.getHeader(DECLARED_LENGTH_HEADER);
  if (declared === undefined) return;
  res.removeHeader(DECLARED_LENGTH_HEADER);
  const value = String(declared);
  if (!/^\d{1,15}$/.test(value) || res.hasHeader("content-encoding") || res.hasHeader("transfer-encoding")) return;
  res.setHeader("content-length", value);
}

type Emit = (this: unknown, event: string | symbol, ...args: unknown[]) => boolean;

export function installDeclaredLength(): void {
  const g = globalThis as Record<symbol, unknown>;
  if (g[MARK]) return;
  for (const proto of [http.Server.prototype, https.Server.prototype] as unknown as { emit: Emit }[]) {
    const original = proto.emit;
    proto.emit = function (this: unknown, event: string | symbol, ...args: unknown[]) {
      if (event === "request") {
        const res = args[1] as http.ServerResponse | undefined;
        if (res && typeof res.writeHead === "function") {
          const writeHead = res.writeHead;
          // Cabeceras implícitas (el primer write) también pasan por writeHead.
          res.writeHead = function (this: http.ServerResponse, ...a: unknown[]) {
            if (!this.headersSent) {
              applyDeclaredLength(this);
              // Y en las páginas HTML, «no-transform» en el Cache-Control (lib/html-no-transform.ts: Cloudflare y los emails).
              applyHtmlNoTransform(this);
            }
            return (writeHead as (...x: unknown[]) => http.ServerResponse).apply(this, a);
          } as typeof res.writeHead;
        }
      }
      return original.call(this, event, ...args);
    };
  }
  g[MARK] = true;
}
