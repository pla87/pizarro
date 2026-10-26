// Cliente mínimo de almacenamiento S3 compatible (Cloudflare R2, Backblaze B2, MinIO, Wasabi…) para las copias
// externas: PUT, GET, HEAD, DELETE y ListObjectsV2 con firma AWS Signature V4 hecha a mano (node:crypto).
// Sin SDK: el de AWS pesa decenas de MB y solo hacen falta cinco operaciones. Se usa node:http(s) en vez de fetch
// porque las subidas van en streaming con Content-Length conocido (el fichero se cifra mientras se envía).
// Direcciones «path-style» (endpoint/bucket/clave), que admiten todos los proveedores citados.
// Nunca se registran ni se devuelven en errores las claves de acceso.

import { createHash, createHmac } from "node:crypto";
import http from "node:http";
import https from "node:https";

export interface S3Config {
  endpoint: string;
  bucket: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** Prefijo de las claves dentro del bucket, vacío o terminado en «/». */
  prefix: string;
}

/** Lee la configuración de BACKUP_S3_*. Sin endpoint ni bucket: no hay S3. A medias: error (sin revelar valores). */
export function parseS3Env(env: Record<string, string | undefined> = process.env): { config: S3Config | null; error: string | null } {
  const v = (k: string) => env[k]?.trim() ?? "";
  const endpoint = v("BACKUP_S3_ENDPOINT");
  const bucket = v("BACKUP_S3_BUCKET");
  const accessKeyId = v("BACKUP_S3_ACCESS_KEY_ID");
  const secretAccessKey = v("BACKUP_S3_SECRET_ACCESS_KEY");
  if (!endpoint && !bucket && !accessKeyId && !secretAccessKey) return { config: null, error: null };
  const missing = [
    ["BACKUP_S3_ENDPOINT", endpoint],
    ["BACKUP_S3_BUCKET", bucket],
    ["BACKUP_S3_ACCESS_KEY_ID", accessKeyId],
    ["BACKUP_S3_SECRET_ACCESS_KEY", secretAccessKey],
  ].filter(([, val]) => !val).map(([k]) => k);
  if (missing.length) return { config: null, error: `Configuración S3 incompleta: falta ${missing.join(", ")}.` };
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return { config: null, error: "BACKUP_S3_ENDPOINT no es una URL válida (p. ej. https://<cuenta>.r2.cloudflarestorage.com)." };
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return { config: null, error: "BACKUP_S3_ENDPOINT debe empezar por https://." };
  let prefix = v("BACKUP_S3_PREFIX").replace(/^\/+/, "");
  if (prefix && !prefix.endsWith("/")) prefix += "/";
  return { config: { endpoint: url.origin + url.pathname.replace(/\/+$/, ""), bucket, region: v("BACKUP_S3_REGION") || "auto", accessKeyId, secretAccessKey, prefix }, error: null };
}

// --- Firma AWS Signature V4 ------------------------------------------------------------------

export const EMPTY_SHA256 = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
export const UNSIGNED_PAYLOAD = "UNSIGNED-PAYLOAD";

export const sha256Hex = (data: string | Buffer) => createHash("sha256").update(data).digest("hex");
const hmac = (key: Buffer | string, data: string) => createHmac("sha256", key).update(data, "utf8").digest();

/** Clave de firma derivada: HMAC encadenado de fecha, región, servicio y «aws4_request». */
export function signingKey(secret: string, date: string, region: string, service: string): Buffer {
  return hmac(hmac(hmac(hmac(`AWS4${secret}`, date), region), service), "aws4_request");
}

/** Codificación URI de AWS (RFC 3986: solo A-Z a-z 0-9 - _ . ~ sin codificar). `keepSlash` para rutas. */
export function uriEncode(s: string, keepSlash = false): string {
  let out = "";
  for (const byte of Buffer.from(s, "utf8")) {
    const c = String.fromCharCode(byte);
    if (/[A-Za-z0-9\-_.~]/.test(c) || (keepSlash && c === "/")) out += c;
    else out += `%${byte.toString(16).toUpperCase().padStart(2, "0")}`;
  }
  return out;
}

/** Query canónica: pares codificados y ordenados por clave (y valor). */
export function canonicalQuery(query: [string, string][]): string {
  return query
    .map(([k, v]) => [uriEncode(k), uriEncode(v)] as const)
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join("&");
}

export interface SignInput {
  method: string;
  /** Ruta ya codificada tal cual va en la petición (p. ej. «/bucket/clave%24rara»). */
  path: string;
  query: [string, string][];
  /** Cabeceras que se firman (sin Authorization). `host` y `x-amz-date` son obligatorias. */
  headers: Record<string, string>;
  payloadHash: string;
}

export interface Credentials {
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
  service: string;
}

/** Firma una petición: devuelve la cabecera Authorization (y las piezas intermedias, para los tests). */
export function signRequest(req: SignInput, cred: Credentials): { authorization: string; canonicalRequest: string; stringToSign: string; signature: string } {
  const headers = Object.entries(req.headers).map(([k, v]) => [k.toLowerCase(), v.trim().replace(/\s+/g, " ")] as const).sort((a, b) => (a[0] < b[0] ? -1 : 1));
  const amzDate = headers.find(([k]) => k === "x-amz-date")?.[1];
  if (!amzDate || !/^\d{8}T\d{6}Z$/.test(amzDate)) throw new Error("x-amz-date ausente o con formato inválido.");
  const signedHeaders = headers.map(([k]) => k).join(";");
  const canonicalRequest = [req.method, req.path || "/", canonicalQuery(req.query), headers.map(([k, v]) => `${k}:${v}\n`).join(""), signedHeaders, req.payloadHash].join("\n");
  const scope = `${amzDate.slice(0, 8)}/${cred.region}/${cred.service}/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256Hex(canonicalRequest)].join("\n");
  const signature = createHmac("sha256", signingKey(cred.secretAccessKey, amzDate.slice(0, 8), cred.region, cred.service)).update(stringToSign, "utf8").digest("hex");
  return { authorization: `AWS4-HMAC-SHA256 Credential=${cred.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`, canonicalRequest, stringToSign, signature };
}

/** 20261025T031500Z */
export function amzDate(at: Date = new Date()): string {
  return at.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

// --- Cliente -----------------------------------------------------------------------------------

/** Cuerpo de una subida: un Buffer o un flujo que se puede volver a crear (para reintentar) con su tamaño exacto. */
export type UploadBody = Buffer | { size: number; stream: () => AsyncIterable<Buffer> };

export class S3Error extends Error {
  constructor(message: string, readonly status: number, readonly code: string | null) {
    super(message);
  }
}

const TIMEOUT_MS = 60_000;
const RETRIES = 3;

function xmlValue(xml: string, tag: string): string | null {
  const m = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`).exec(xml);
  return m ? decodeXml(m[1]!) : null;
}
function decodeXml(s: string): string {
  return s.replace(/&(lt|gt|amp|quot|apos|#\d+|#x[0-9a-f]+);/gi, (_, e: string) =>
    e === "lt" ? "<" : e === "gt" ? ">" : e === "amp" ? "&" : e === "quot" ? '"' : e === "apos" ? "'" : String.fromCodePoint(e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)),
  );
}

async function readAll(res: http.IncomingMessage, limit = 1024 * 1024): Promise<string> {
  const parts: Buffer[] = [];
  let n = 0;
  for await (const c of res) {
    n += (c as Buffer).length;
    if (n <= limit) parts.push(c as Buffer);
  }
  return Buffer.concat(parts).toString("utf8");
}

export class S3Client {
  private readonly base: URL;
  constructor(readonly config: S3Config) {
    this.base = new URL(config.endpoint);
  }

  /** Descripción sin secretos: host/bucket/prefijo. */
  get label(): string {
    return `${this.base.host}/${this.config.bucket}${this.config.prefix ? `/${this.config.prefix.replace(/\/$/, "")}` : ""}`;
  }

  private path(key: string | null): string {
    const basePath = this.base.pathname.replace(/\/+$/, "");
    return `${basePath}/${uriEncode(this.config.bucket)}${key === null ? "" : `/${uriEncode(this.config.prefix + key, true)}`}`;
  }

  /** Una petición firmada. Devuelve la respuesta sin leer (quien llama consume o descarta el cuerpo). */
  private send(method: string, key: string | null, opts: { query?: [string, string][]; body?: UploadBody } = {}): Promise<http.IncomingMessage> {
    const query = opts.query ?? [];
    const path = this.path(key);
    const body = opts.body;
    const size = body === undefined ? 0 : Buffer.isBuffer(body) ? body.length : body.size;
    const headers: Record<string, string> = {
      host: this.base.host,
      "x-amz-date": amzDate(),
      // Los Buffers (manifiestos) van con su hash; los flujos grandes, sin firmar el contenido (lo protege el GCM).
      "x-amz-content-sha256": body === undefined ? EMPTY_SHA256 : Buffer.isBuffer(body) ? sha256Hex(body) : UNSIGNED_PAYLOAD,
    };
    const { authorization } = signRequest({ method, path, query, headers, payloadHash: headers["x-amz-content-sha256"]! }, { ...this.config, service: "s3" });
    const qs = canonicalQuery(query);
    const mod = this.base.protocol === "https:" ? https : http;
    return new Promise((resolve, reject) => {
      const req = mod.request(
        {
          method,
          protocol: this.base.protocol,
          hostname: this.base.hostname,
          port: this.base.port || undefined,
          path: qs ? `${path}?${qs}` : path,
          headers: { ...headers, authorization, ...(body !== undefined || method === "PUT" ? { "content-length": String(size) } : {}) },
        },
        resolve,
      );
      req.setTimeout(TIMEOUT_MS, () => req.destroy(new Error(`Sin respuesta de S3 en ${TIMEOUT_MS / 1000} s.`)));
      req.on("error", reject);
      if (body === undefined) req.end();
      else if (Buffer.isBuffer(body)) req.end(body);
      else {
        // Flujo: se escribe respetando la contrapresión; si el origen falla, se aborta la petición (S3 descarta la subida a medias).
        void (async () => {
          let sent = 0;
          try {
            for await (const chunk of body.stream()) {
              sent += chunk.length;
              if (req.destroyed) throw new Error("La conexión con S3 se cerró durante la subida.");
              // S3 puede responder (403…) y cerrar antes de terminar: también se deja de esperar entonces.
              if (!req.write(chunk)) await new Promise<void>((r) => { req.once("drain", r); req.once("close", r); });
            }
            if (sent !== size) throw new Error(`El fichero cambió de tamaño durante la subida (${sent} de ${size} bytes).`);
            req.end();
          } catch (err) {
            req.destroy(err instanceof Error ? err : new Error(String(err)));
          }
        })();
      }
    });
  }

  /** Petición con reintentos ante errores de red, 5xx y 429. `expect` son los códigos que se dan por buenos. */
  private async request(method: string, key: string | null, opts: { query?: [string, string][]; body?: UploadBody; expect: number[] }): Promise<http.IncomingMessage> {
    let lastErr: unknown;
    for (let attempt = 0; attempt < RETRIES; attempt++) {
      if (attempt > 0) await new Promise((r) => setTimeout(r, 500 * 2 ** attempt));
      let res: http.IncomingMessage;
      try {
        res = await this.send(method, key, opts);
      } catch (err) {
        lastErr = err;
        if (err instanceof Error && /cambió de tamaño/.test(err.message)) throw err;
        continue;
      }
      const status = res.statusCode ?? 0;
      if (opts.expect.includes(status)) return res;
      const text = method === "HEAD" ? "" : await readAll(res);
      if (method === "HEAD") res.resume();
      const code = xmlValue(text, "Code");
      const err = new S3Error(`S3 ${method} ${key ?? "(bucket)"}: HTTP ${status}${code ? ` ${code}` : ""}${xmlValue(text, "Message") ? ` (${xmlValue(text, "Message")})` : ""}`, status, code);
      if (status >= 500 || status === 429) {
        lastErr = err;
        continue;
      }
      throw err;
    }
    throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
  }

  async put(key: string, body: UploadBody): Promise<void> {
    (await this.request("PUT", key, { body, expect: [200, 201, 204] })).resume();
  }

  /** Tamaño del objeto, o null si no existe. */
  async head(key: string): Promise<number | null> {
    const res = await this.request("HEAD", key, { expect: [200, 404] });
    res.resume();
    return res.statusCode === 404 ? null : Number(res.headers["content-length"] ?? 0);
  }

  /** Contenido del objeto en streaming. */
  async get(key: string): Promise<AsyncIterable<Buffer>> {
    return this.request("GET", key, { expect: [200] });
  }

  async delete(key: string): Promise<void> {
    (await this.request("DELETE", key, { expect: [200, 204, 404] })).resume();
  }

  /** Claves bajo `prefix` (relativas al prefijo configurado), paginando con ListObjectsV2. Con `delimiter`, sin entrar en «carpetas». */
  async *list(prefix = "", delimiter?: string): AsyncGenerator<{ key: string; size: number }> {
    let token: string | null = null;
    do {
      const query: [string, string][] = [["list-type", "2"], ["prefix", this.config.prefix + prefix], ["max-keys", "1000"]];
      if (delimiter) query.push(["delimiter", delimiter]);
      if (token) query.push(["continuation-token", token]);
      const xml = await readAll(await this.request("GET", null, { query, expect: [200] }), 64 * 1024 * 1024);
      for (const m of xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)) {
        const full = xmlValue(m[1]!, "Key");
        if (full === null || !full.startsWith(this.config.prefix)) continue;
        yield { key: full.slice(this.config.prefix.length), size: Number(xmlValue(m[1]!, "Size") ?? 0) };
      }
      token = xmlValue(xml, "IsTruncated") === "true" ? xmlValue(xml, "NextContinuationToken") : null;
    } while (token);
  }
}
