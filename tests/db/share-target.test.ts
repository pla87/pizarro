// «Compartir → Pizarro» (share_target): la ruta que recibe lo compartido (origen, sesión, topes), el almacén temporal por
// persona (solo su dueño lo lee, caduca, se borra al usarlo) y su limpieza. Contra PostgreSQL real.
import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, test } from "node:test";
import { db, loginAs, logout, makeProject, makeUser } from "./helpers";
import { POST as shareRoute } from "../../src/app/api/share/route";
import { GET as shareFileRoute } from "../../src/app/api/share/[shareId]/[index]/route";
import { DELETE as shareDropRoute } from "../../src/app/api/share/[shareId]/route";
import { SHARE_MAX_FILES, SHARE_MAX_PENDING, SHARE_TTL_MS, shareLimits } from "../../src/lib/share-core";
import { purgeShares, readShare, sharedDir, stageShare } from "../../src/lib/share-inbox";
import { MAINTENANCE_JOBS } from "../../src/lib/maintenance";

process.env.UPLOAD_DIR = await mkdtemp(path.join(tmpdir(), "pz-share-"));
const BASE = "http://localhost";

/** Lo que manda el navegador al compartir: navegación POST suya (Sec-Fetch-Site: none, sin Origin). */
function shareRequest(fields: { title?: string; text?: string; url?: string; files?: File[] }, headers: Record<string, string> = { "sec-fetch-site": "none" }) {
  const form = new FormData();
  for (const k of ["title", "text", "url"] as const) if (fields[k] !== undefined) form.append(k, fields[k]!);
  for (const f of fields.files ?? []) form.append("files", f);
  const encoded = new Request(`${BASE}/api/share`, { method: "POST", body: form });
  return encoded.arrayBuffer().then((buf) => new Request(`${BASE}/api/share`, {
    method: "POST", body: buf,
    headers: { host: "localhost", "content-type": encoded.headers.get("content-type")!, "content-length": String(buf.byteLength), ...headers },
  }));
}
const location = (res: Response) => res.headers.get("location") ?? "";
const shareIdOf = (res: Response) => new URL(location(res), BASE).searchParams.get("id");

describe("compartir con Pizarro", () => {
  test("con sesión guarda textos y archivos para su dueño y redirige a /share; solo el dueño los lee y se borran al usarlos", async () => {
    const ana = await makeUser();
    const otro = await makeUser();
    await makeProject({ members: [ana, otro] });
    await loginAs(ana);
    const res = await shareRoute(await shareRequest({ title: "Página", text: "Mira esto", url: "https://example.com/a", files: [new File(["hola"], "nota.txt", { type: "text/plain" }), new File([new Uint8Array([1, 2, 3])], "foto.png", { type: "image/png" })] }));
    assert.equal(res.status, 303);
    assert.match(location(res), /^\/share\?id=[a-z0-9]+$/);
    const id = shareIdOf(res)!;
    const meta = await readShare(ana.id, id);
    assert.deepEqual({ title: meta?.title, text: meta?.text, url: meta?.url }, { title: "Página", text: "Mira esto", url: "https://example.com/a" });
    assert.deepEqual(meta?.files, [{ name: "nota.txt", type: "text/plain", size: 4 }, { name: "foto.png", type: "image/png", size: 3 }]);
    assert.equal(res.headers.get("x-pizarro-upload-per-user") !== null, true, "lleva la cabecera del reparto de subidas, como las demás");

    const file = await shareFileRoute(new Request(`${BASE}/api/share/${id}/0`), { params: Promise.resolve({ shareId: id, index: "0" }) });
    assert.equal(file.status, 200);
    assert.equal(file.headers.get("content-type"), "application/octet-stream");
    assert.equal(await file.text(), "hola");
    const missing = await shareFileRoute(new Request(`${BASE}/api/share/${id}/7`), { params: Promise.resolve({ shareId: id, index: "7" }) });
    assert.equal(missing.status, 404);

    // Otra persona no lo ve ni lo borra.
    await loginAs(otro);
    assert.equal(await readShare(otro.id, id), null);
    const theirs = await shareFileRoute(new Request(`${BASE}/api/share/${id}/0`), { params: Promise.resolve({ shareId: id, index: "0" }) });
    assert.equal(theirs.status, 404);
    await shareDropRoute(new Request(`${BASE}/api/share/${id}`, { method: "DELETE", headers: { origin: BASE, host: "localhost" } }), { params: Promise.resolve({ shareId: id }) });
    assert.ok(await readShare(ana.id, id), "sigue ahí: no era suyo");

    await loginAs(ana);
    const cross = await shareDropRoute(new Request(`${BASE}/api/share/${id}`, { method: "DELETE", headers: { origin: "https://evil.example.com", host: "localhost" } }), { params: Promise.resolve({ shareId: id }) });
    assert.equal(cross.status, 403);
    const drop = await shareDropRoute(new Request(`${BASE}/api/share/${id}`, { method: "DELETE", headers: { origin: BASE, host: "localhost" } }), { params: Promise.resolve({ shareId: id }) });
    assert.equal(drop.status, 204);
    assert.equal(await readShare(ana.id, id), null);
    // Guardarlo no ha creado nada: ni tareas ni adjuntos.
    assert.equal(await db.task.count({ where: { project: { members: { some: { userId: ana.id } } } } }), 0);
    assert.equal(await db.taskAttachment.count({ where: { createdById: ana.id } }), 0);
  });

  test("desde otra web (cross-site u Origin ajeno) se rechaza sin guardar nada", async () => {
    const ana = await makeUser();
    await makeProject({ members: [ana] });
    await loginAs(ana);
    const cases: Record<string, string>[] = [{ "sec-fetch-site": "cross-site", origin: "https://evil.example.com" }, { origin: "https://evil.example.com" }, { "sec-fetch-site": "same-site" }, {}];
    for (const headers of cases) {
      const res = await shareRoute(await shareRequest({ text: "x", files: [new File(["a"], "a.txt")] }, headers));
      assert.equal(res.status, 403, JSON.stringify(headers));
    }
    assert.deepEqual(await readdir(path.join(sharedDir(), ana.id)).catch(() => []), []);
    // Desde la propia app (formulario del mismo origen) sí vale.
    const same = await shareRoute(await shareRequest({ text: "x" }, { "sec-fetch-site": "same-origin", origin: BASE }));
    assert.equal(same.status, 303);
  });

  test("sin sesión no guarda archivos: al acceso con vuelta a /share y solo los textos", async () => {
    await logout();
    const res = await shareRoute(await shareRequest({ title: "Hola", url: "https://example.com/x", files: [new File(["a"], "a.txt")] }));
    assert.equal(res.status, 303);
    const loc = new URL(location(res), BASE);
    assert.equal(loc.pathname, "/login");
    const next = new URL(loc.searchParams.get("next")!, BASE);
    assert.equal(next.pathname, "/share");
    assert.equal(next.searchParams.get("title"), "Hola");
    assert.equal(next.searchParams.get("url"), "https://example.com/x");
    assert.equal(next.searchParams.get("lost"), "1");
  });

  test("topes: tamaño de una subida, archivos por envío, envíos pendientes por persona; vacío no guarda nada", async () => {
    const ana = await makeUser();
    const f = await makeProject({ members: [ana] });
    await db.project.update({ where: { id: f.project.id }, data: { fileMaxMb: 1 } });
    await loginAs(ana);
    const big = await shareRoute(await shareRequest({ files: [new File([new Uint8Array(2 * 1024 * 1024)], "grande.bin")] }));
    assert.equal(location(big), "/share?error=too_big");
    const empty = await shareRoute(await shareRequest({ text: "  " }));
    assert.equal(location(empty), "/share?error=empty");
    const many = await shareRoute(await shareRequest({ files: Array.from({ length: SHARE_MAX_FILES + 2 }, (_, i) => new File([`f${i}`], `f${i}.txt`)) }));
    assert.match(location(many), /&omitidos=2$/);
    assert.equal((await readShare(ana.id, shareIdOf(many)!))?.files.length, SHARE_MAX_FILES);
    for (let i = 0; i < SHARE_MAX_PENDING + 2; i++) await shareRoute(await shareRequest({ text: `envío ${i}` }));
    assert.equal((await readdir(path.join(sharedDir(), ana.id))).length, SHARE_MAX_PENDING, "un envío nuevo retira los más antiguos");
  });

  test("topes: cada archivo, el de un adjunto; el envío entero, diez veces eso (100 MB como mucho)", async () => {
    const MB = 1024 * 1024;
    assert.deepEqual(shareLimits(20 * MB), { fileMaxBytes: 20 * MB, totalMaxBytes: 100 * MB });
    assert.deepEqual(shareLimits(5 * MB), { fileMaxBytes: 5 * MB, totalMaxBytes: 50 * MB });
    assert.deepEqual(shareLimits(100 * MB), { fileMaxBytes: 100 * MB, totalMaxBytes: 100 * MB });
    const ana = await makeUser();
    const f = await makeProject({ members: [ana] });
    await db.project.update({ where: { id: f.project.id }, data: { fileMaxMb: 1 } });
    await loginAs(ana);
    // Cinco fotos que caben una a una pero no juntas en el tope de un archivo: antes, too_big.
    const photos = Array.from({ length: 5 }, (_, i) => new File([new Uint8Array(800 * 1024)], `foto${i}.jpg`, { type: "image/jpeg" }));
    const ok = await shareRoute(await shareRequest({ files: photos }));
    assert.match(location(ok), /^\/share\?id=/);
    assert.equal((await readShare(ana.id, shareIdOf(ok)!))?.files.length, 5);
    // Un archivo que pasa del tope de un adjunto no entra aunque el envío quepa.
    const one = await shareRoute(await shareRequest({ files: [new File([new Uint8Array(1.5 * MB)], "grande.bin")] }));
    assert.equal(location(one), "/share?error=too_big");
    // Más que el tope del envío entero (10 × 1 MB): se corta antes de leerlo.
    const all = await shareRoute(await shareRequest({ files: Array.from({ length: 11 }, (_, i) => new File([new Uint8Array(1000 * 1024)], `f${i}.bin`)) }));
    assert.equal(location(all), "/share?error=too_big");
  });

  test("con el disco casi lleno no se recibe nada", async () => {
    const ana = await makeUser();
    await makeProject({ members: [ana] });
    await loginAs(ana);
    process.env.DISK_MIN_FREE_MB = String(1024 * 1024 * 1024);
    try {
      const res = await shareRoute(await shareRequest({ text: "nota", files: [new File(["hola"], "a.txt")] }));
      assert.equal(location(res), "/share?error=failed");
      assert.deepEqual(await readdir(path.join(sharedDir(), ana.id)).catch(() => []), []);
    } finally {
      delete process.env.DISK_MIN_FREE_MB;
    }
  });

  test("caduca: no se puede leer pasado el plazo y la tarea de mantenimiento lo borra", async () => {
    const ana = await makeUser();
    const old = await stageShare(ana.id, { title: "", text: "viejo", url: "" }, [{ name: "a.txt", type: "text/plain", data: Buffer.from("a") }], Date.now() - SHARE_TTL_MS - 1000);
    const fresh = await stageShare(ana.id, { title: "", text: "nuevo", url: "" }, []);
    assert.equal(await readShare(ana.id, old), null, "caducado: ya no se lee (y el envío nuevo lo ha retirado)");
    const old2 = await stageShare(ana.id, { title: "", text: "viejo 2", url: "" }, [], Date.now() - SHARE_TTL_MS - 1000);
    assert.equal(JSON.parse(await readFile(path.join(sharedDir(), ana.id, old2, "meta.json"), "utf8")).text, "viejo 2");
    assert.ok(MAINTENANCE_JOBS.some((j) => j.name === "sharedFiles"), "la limpieza va con el mantenimiento");
    assert.ok((await purgeShares()) >= 1);
    assert.deepEqual(await readdir(path.join(sharedDir(), ana.id)), [fresh]);
  });
});
