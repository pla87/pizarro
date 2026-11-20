// Rutas del ZIP de adjuntos (release-attachments con vale y /api/releases/[id]/attachments) contra PostgreSQL real: el
// vale solo da por terminado un paquete enviado entero (cortado o cancelado queda como fallido, para que la página lo
// avise) y HEAD no reserva el hueco del ZIP ni lee nada.
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, test } from "node:test";
import { db, loginAs, makeProject, makeTask, makeUser } from "./helpers";
import { GET as ticketGet, HEAD as ticketHead, POST as planPost } from "../../src/app/api/projects/[projectId]/release-attachments/route";
import { HEAD as releaseHead } from "../../src/app/api/releases/[releaseId]/attachments/route";
import { acquireZipSlot } from "../../src/lib/release-zip";
import { attachmentPath } from "../../src/lib/uploads";

process.env.UPLOAD_DIR = await mkdtemp(path.join(tmpdir(), "pz-zip-routes-"));

async function setup() {
  const user = await makeUser();
  const f = await makeProject({ members: [user] });
  const task = await makeTask(f);
  const att = await db.taskAttachment.create({ data: { taskId: task.id, originalName: "datos.bin", size: 4096, isImage: false, mimeType: "application/octet-stream" } });
  await writeFile(attachmentPath(att.id, "file"), Buffer.alloc(4096, 1));
  await loginAs(user);
  const base = `http://localhost/api/projects/${f.project.id}/release-attachments`;
  const ctx = { params: Promise.resolve({ projectId: f.project.id }) };
  const plan = await planPost(
    new Request(`${base}?plan=1`, { method: "POST", headers: { origin: "http://localhost", host: "localhost", "content-type": "application/json" }, body: JSON.stringify({ items: [{ taskId: task.id, code: "A1" }] }) }),
    ctx,
  );
  assert.equal(plan.status, 200);
  const { ticket, v } = (await plan.json()) as { ticket: string; v: string };
  const partUrl = `${base}?ticket=${encodeURIComponent(ticket)}&part=1&v=${v}`;
  const status = async () => (await (await ticketGet(new Request(`${base}?ticket=${encodeURIComponent(ticket)}&status=1`), ctx)).json()) as { started: number[]; done: number[]; errors: Record<string, { status: number }> };
  return { user, f, ctx, partUrl, status };
}

const slotFree = (userId: string) => {
  const s = acquireZipSlot(userId);
  s?.();
  return s !== null;
};

describe("ZIP con vale: el paquete solo cuenta como terminado si se envió entero", () => {
  test("enviado entero: terminado", async () => {
    const { user, ctx, partUrl, status } = await setup();
    const res = await ticketGet(new Request(partUrl), ctx);
    assert.equal(res.status, 200);
    await res.arrayBuffer();
    const st = await status();
    assert.deepEqual([st.done, st.errors], [[1], {}]);
    assert.ok(slotFree(user.id));
  });

  test("cancelado a medias: fallido (no terminado) y hueco libre", async () => {
    const { user, ctx, partUrl, status } = await setup();
    const res = await ticketGet(new Request(partUrl), ctx);
    const reader = res.body!.getReader();
    await reader.read();
    await reader.cancel();
    const st = await status();
    assert.deepEqual(st.done, [], "no se da por terminado");
    assert.equal(st.errors["1"]?.status, 500, "queda como fallido para que la página lo avise");
    assert.ok(slotFree(user.id));
  });
});

describe("HEAD sobre las rutas del ZIP", () => {
  test("no reserva el hueco, no marca el paquete y no sirve nada", async () => {
    const { user, status } = await setup();
    const head = await ticketHead();
    assert.equal(head.status, 405);
    assert.equal(head.body, null);
    assert.ok(slotFree(user.id), "el GET de verdad no se encuentra con «Ya se está preparando otro ZIP»");
    assert.deepEqual((await status()).started, []);
    const rel = await releaseHead();
    assert.equal(rel.status, 405);
    assert.ok(slotFree(user.id));
  });
});
