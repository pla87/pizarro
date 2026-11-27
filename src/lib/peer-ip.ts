// Dirección de la conexión en cada petición (solo runtime Node; lo instala instrumentation.ts al arrancar).
//
// Next no da a las rutas ni a las acciones la dirección del socket (`request.ip` desapareció en Next 15), y lo único
// que ve el código son las cabeceras. Por eso, antes de que Next reciba la petición, se escribe la dirección de la
// conexión en una cabecera interna (PEER_IP_HEADER), sustituyendo la que mande el cliente. Así, sin proxy delante
// (TRUST_PROXY sin activar), la IP es la de verdad y no la que alguien ponga en X-Forwarded-For. Ver lib/client-ip.ts.

import http from "node:http";
import https from "node:https";
import { AUTH_LINK_HEADER } from "./auth-link-path";
import { PEER_IP_HEADER, PEER_IP_MARK } from "./client-ip";

/** Las que escribe solo el proxy (ruta para Logs, enlace de email para el idioma, nonce de la CSP). */
const INTERNAL_HEADERS = ["x-pz-path", AUTH_LINK_HEADER, "x-nonce"] as const;

type Emit = (this: unknown, event: string | symbol, ...args: unknown[]) => boolean;

export function installPeerIpHeader(): void {
  const g = globalThis as Record<symbol, unknown>;
  if (g[PEER_IP_MARK]) return;
  for (const proto of [http.Server.prototype, https.Server.prototype] as unknown as { emit: Emit }[]) {
    const original = proto.emit;
    proto.emit = function (this: unknown, event: string | symbol, ...args: unknown[]) {
      if (event === "request") {
        const req = args[0] as http.IncomingMessage | undefined;
        if (req?.headers) {
          const addr = req.socket?.remoteAddress;
          if (addr) req.headers[PEER_IP_HEADER] = addr;
          else delete req.headers[PEER_IP_HEADER];
          // Cabeceras internas que pone src/proxy.ts: la que mande el cliente no vale nunca, tampoco en las rutas que
          // quedan fuera del matcher del proxy (subidas, importar, /x/…), donde nadie las borraba.
          for (const h of INTERNAL_HEADERS) delete req.headers[h];
        }
      }
      return original.call(this, event, ...args);
    };
  }
  g[PEER_IP_MARK] = true;
}
