// Lado del navegador y del servicio push, para las pruebas de los avisos push (tests/push.test.ts y tests/db/push.test.ts):
// un «navegador» con su par P-256 y su secreto `auth` que descifra lo que manda Pizarro (RFC 8291), la comprobación del
// JWT VAPID (RFC 8292) y un servidor push falso en localhost que responde lo que se le pida.
import { createDecipheriv, createECDH, createHmac, createPublicKey, randomBytes, verify } from "node:crypto";
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";

const hmac = (key: Uint8Array, data: Uint8Array) => createHmac("sha256", key).update(data).digest();
const hkdf = (salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, n: number) => hmac(hmac(salt, ikm), Buffer.concat([info, Buffer.from([1])])).subarray(0, n);

export interface FakeBrowser {
  keys: { p256dh: string; auth: string };
  decrypt(body: Buffer): Buffer;
}

/** Un navegador suscrito: sus claves (como las da PushSubscription.toJSON()) y cómo descifra un aviso. */
export function fakeBrowser(priv?: Buffer, auth?: Buffer): FakeBrowser {
  const ecdh = createECDH("prime256v1");
  if (priv) ecdh.setPrivateKey(priv);
  else ecdh.generateKeys();
  const secret = auth ?? randomBytes(16);
  const uaPublic = ecdh.getPublicKey();
  return {
    keys: { p256dh: uaPublic.toString("base64url"), auth: secret.toString("base64url") },
    decrypt(body) {
      const salt = body.subarray(0, 16);
      const rs = body.readUInt32BE(16);
      const idlen = body[20]!;
      const asPublic = body.subarray(21, 21 + idlen);
      const data = body.subarray(21 + idlen);
      if (rs < data.length) throw new Error("registro mayor que rs");
      const shared = ecdh.computeSecret(asPublic);
      const ikm = hkdf(secret, shared, Buffer.concat([Buffer.from("WebPush: info\0"), uaPublic, asPublic]), 32);
      const cek = hkdf(salt, ikm, Buffer.from("Content-Encoding: aes128gcm\0"), 16);
      const nonce = hkdf(salt, ikm, Buffer.from("Content-Encoding: nonce\0"), 12);
      const d = createDecipheriv("aes-128-gcm", cek, nonce);
      d.setAuthTag(data.subarray(data.length - 16));
      const plain = Buffer.concat([d.update(data.subarray(0, data.length - 16)), d.final()]);
      // Quita el relleno y el delimitador del último registro (0x02).
      let end = plain.length - 1;
      while (end >= 0 && plain[end] === 0) end--;
      if (plain[end] !== 2) throw new Error("falta el delimitador del último registro");
      return plain.subarray(0, end);
    },
  };
}

/** Comprueba la cabecera Authorization «vapid t=…, k=…» como un servicio push: firma, audiencia y caducidad. */
export function checkVapid(authorization: string | undefined, origin: string, nowSec = Math.floor(Date.now() / 1000)): { sub: string; k: string } {
  const m = /^vapid t=([^,\s]+),\s*k=([A-Za-z0-9_-]+)$/.exec(authorization ?? "");
  if (!m) throw new Error(`Authorization no es VAPID: ${authorization}`);
  const [h, c, s] = m[1]!.split(".");
  const header = JSON.parse(Buffer.from(h!, "base64url").toString());
  const claims = JSON.parse(Buffer.from(c!, "base64url").toString());
  if (header.alg !== "ES256" || header.typ !== "JWT") throw new Error("cabecera JWT inesperada");
  const pub = Buffer.from(m[2]!, "base64url");
  const key = createPublicKey({ key: { kty: "EC", crv: "P-256", x: pub.subarray(1, 33).toString("base64url"), y: pub.subarray(33).toString("base64url") }, format: "jwk" });
  if (!verify("sha256", Buffer.from(`${h}.${c}`), { key, dsaEncoding: "ieee-p1363" }, Buffer.from(s!, "base64url"))) throw new Error("firma VAPID no válida");
  if (claims.aud !== origin) throw new Error(`aud ${claims.aud} ≠ ${origin}`);
  if (!(claims.exp > nowSec && claims.exp <= nowSec + 24 * 3600)) throw new Error("exp fuera de plazo");
  if (!/^(mailto:|https?:)/.test(claims.sub)) throw new Error("sub no válido");
  return { sub: claims.sub, k: m[2]! };
}

export interface PushHit {
  path: string;
  headers: IncomingMessage["headers"];
  body: Buffer;
}

/** Servidor push falso (http en 127.0.0.1): guarda cada POST y responde `status(path)` (201 por defecto). */
export async function fakePushServer(status: (path: string) => number = () => 201): Promise<{ hits: PushHit[]; url: string; close: () => Promise<void>; server: Server }> {
  const hits: PushHit[] = [];
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      const path = req.url ?? "/";
      hits.push({ path, headers: req.headers, body: Buffer.concat(chunks) });
      res.statusCode = status(path);
      res.end();
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address() as AddressInfo;
  return { hits, url: `http://127.0.0.1:${port}`, server, close: () => new Promise<void>((r) => server.close(() => r())) };
}
