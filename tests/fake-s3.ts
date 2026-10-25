// Servidor S3 falso, en el mismo proceso, para los tests de las copias externas. Implementa lo que usa
// backup-s3.ts (PUT, GET, HEAD, DELETE y ListObjectsV2 con paginación) y COMPRUEBA la firma Signature V4 de cada
// petición con una canonicalización propia (independiente de la del cliente). Si no cuadra, responde 403 como S3.
import { createHash, createHmac } from "node:crypto";
import http from "node:http";
import type { AddressInfo } from "node:net";

export interface FakeS3 {
  endpoint: string;
  bucket: string;
  objects: Map<string, Buffer>;
  /** Peticiones recibidas (método y clave), para comprobar qué se subió. */
  log: { method: string; key: string; status: number }[];
  /** Si devuelve true, la petición falla con 500 (para probar reintentos y cortes). */
  failIf: ((method: string, key: string) => boolean) | null;
  close(): Promise<void>;
}

const enc = (s: string, slash: boolean) =>
  [...Buffer.from(s, "utf8")].map((b) => {
    const c = String.fromCharCode(b);
    return /[A-Za-z0-9\-_.~]/.test(c) || (slash && c === "/") ? c : `%${b.toString(16).toUpperCase().padStart(2, "0")}`;
  }).join("");

const hmac = (k: Buffer | string, d: string) => createHmac("sha256", k).update(d).digest();

function expectedSignature(req: http.IncomingMessage, rawPath: string, rawQuery: string, signed: string[], payloadHash: string, scope: string[], secret: string): string {
  const query = rawQuery
    ? rawQuery.split("&").map((p) => {
        const [k, v = ""] = p.split("=");
        return [enc(decodeURIComponent(k!), false), enc(decodeURIComponent(v), false)] as const;
      }).sort((a, b) => (a[0] === b[0] ? (a[1] < b[1] ? -1 : 1) : a[0] < b[0] ? -1 : 1)).map(([k, v]) => `${k}=${v}`).join("&")
    : "";
  const headers = signed.map((h) => `${h}:${String(req.headers[h] ?? "").trim().replace(/\s+/g, " ")}\n`).join("");
  const canonical = [req.method, rawPath, query, headers, signed.join(";"), payloadHash].join("\n");
  const date = String(req.headers["x-amz-date"]);
  const sts = ["AWS4-HMAC-SHA256", date, `${scope.join("/")}/aws4_request`, createHash("sha256").update(canonical).digest("hex")].join("\n");
  const [day, region, service] = scope;
  const k = hmac(hmac(hmac(hmac(`AWS4${secret}`, day!), region!), service!), "aws4_request");
  return createHmac("sha256", k).update(sts).digest("hex");
}

const xml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export async function startFakeS3(opts: { accessKeyId: string; secretAccessKey: string; region?: string; bucket?: string; pageSize?: number }): Promise<FakeS3> {
  const bucket = opts.bucket ?? "copias";
  const region = opts.region ?? "auto";
  const pageSize = opts.pageSize ?? 3;
  const objects = new Map<string, Buffer>();
  const log: FakeS3["log"] = [];
  const state: FakeS3 = { endpoint: "", bucket, objects, log, failIf: null, close: async () => {} };

  const server = http.createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const body = Buffer.concat(chunks);
    const [rawPath = "/", rawQuery = ""] = (req.url ?? "/").split("?");
    const parts = rawPath.split("/").slice(1);
    const key = parts.slice(1).map(decodeURIComponent).join("/");
    const reply = (status: number, text = "", headers: Record<string, string> = {}) => {
      log.push({ method: req.method!, key, status });
      res.writeHead(status, { "content-type": "application/xml", ...headers });
      res.end(req.method === "HEAD" ? undefined : text);
    };
    const error = (status: number, code: string) => reply(status, `<?xml version="1.0"?><Error><Code>${code}</Code><Message>${code}</Message></Error>`);

    // --- Firma ---
    const auth = String(req.headers.authorization ?? "");
    const m = /^AWS4-HMAC-SHA256 Credential=([^/]+)\/(\d{8})\/([^/]+)\/(s3)\/aws4_request, SignedHeaders=([a-z0-9;-]+), Signature=([0-9a-f]{64})$/.exec(auth);
    if (!m) return error(403, "AccessDenied");
    const [, akid, day, reg, service, signedList, signature] = m;
    const signed = signedList!.split(";");
    const payloadHash = String(req.headers["x-amz-content-sha256"] ?? "");
    if (akid !== opts.accessKeyId) return error(403, "InvalidAccessKeyId");
    if (reg !== region || !signed.includes("host") || !signed.includes("x-amz-date") || !signed.includes("x-amz-content-sha256")) return error(403, "AuthorizationHeaderMalformed");
    if (!String(req.headers["x-amz-date"]).startsWith(day!)) return error(403, "SignatureDoesNotMatch");
    if (expectedSignature(req, rawPath, rawQuery, signed, payloadHash, [day!, reg!, service!], opts.secretAccessKey) !== signature) return error(403, "SignatureDoesNotMatch");
    if (payloadHash !== "UNSIGNED-PAYLOAD" && createHash("sha256").update(body).digest("hex") !== payloadHash) return error(400, "XAmzContentSHA256Mismatch");

    if (parts[0] !== bucket) return error(404, "NoSuchBucket");
    if (state.failIf?.(req.method!, key)) return error(500, "InternalError");

    if (!key && req.method === "GET") {
      const q = new URLSearchParams(rawQuery);
      if (q.get("list-type") !== "2") return error(400, "InvalidArgument");
      const prefix = q.get("prefix") ?? "";
      const delimiter = q.get("delimiter");
      const start = q.get("continuation-token") ?? "";
      const all = [...objects.keys()].filter((k) => k.startsWith(prefix) && (!delimiter || !k.slice(prefix.length).includes(delimiter))).sort().filter((k) => k > start);
      const page = all.slice(0, Math.min(pageSize, Number(q.get("max-keys") ?? 1000)));
      const truncated = all.length > page.length;
      const contents = page.map((k) => `<Contents><Key>${xml(k)}</Key><Size>${objects.get(k)!.length}</Size></Contents>`).join("");
      return reply(200, `<?xml version="1.0"?><ListBucketResult><Name>${bucket}</Name><KeyCount>${page.length}</KeyCount><IsTruncated>${truncated}</IsTruncated>${truncated ? `<NextContinuationToken>${xml(page[page.length - 1]!)}</NextContinuationToken>` : ""}${contents}</ListBucketResult>`);
    }
    switch (req.method) {
      case "PUT":
        if (Number(req.headers["content-length"]) !== body.length) return error(400, "IncompleteBody");
        objects.set(key, body);
        return reply(200);
      case "GET": {
        const obj = objects.get(key);
        if (!obj) return error(404, "NoSuchKey");
        log.push({ method: "GET", key, status: 200 });
        res.writeHead(200, { "content-length": String(obj.length) });
        return res.end(obj);
      }
      case "HEAD": {
        const obj = objects.get(key);
        return obj ? reply(200, "", { "content-length": String(obj.length) }) : reply(404);
      }
      case "DELETE":
        objects.delete(key);
        return reply(204);
      default:
        return error(405, "MethodNotAllowed");
    }
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  state.endpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  state.close = () => new Promise<void>((r) => server.close(() => r()));
  return state;
}
