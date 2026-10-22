import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, stat, symlink, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { cleanOrphanFiles, isInside, parseUploadName } from "../src/lib/orphan-files";
import { checkQuota } from "../src/lib/quota";
import { MAX_STREAMS_PER_USER, openStreamCount, registerStream, revokeProjectStreams, revokeSessionStreams, revokeUserStreams } from "../src/lib/realtime";

const MB = 1024 * 1024;

test("cuota: por proyecto y total, con el uso en MB", () => {
  const limits = { project: 100 * MB, total: 500 * MB };
  assert.equal(checkQuota({ project: 10 * MB, total: 10 * MB }, 5 * MB, limits), null);
  assert.deepEqual(checkQuota({ project: 98 * MB, total: 98 * MB }, 5 * MB, limits), { scope: "project", usedMb: 98, limitMb: 100 });
  assert.deepEqual(checkQuota({ project: 10 * MB, total: 498 * MB }, 5 * MB, limits), { scope: "total", usedMb: 498, limitMb: 500 });
  assert.equal(checkQuota({ project: 99 * MB, total: 10_000 * MB }, 1 * MB, { project: 100 * MB, total: null }), null);
});

test("nombres de fichero reconocidos", () => {
  assert.deepEqual(parseUploadName("clx9abc.webp", "root"), { id: "clx9abc" });
  assert.deepEqual(parseUploadName("clx9abc.thumb.webp", "root"), { id: "clx9abc" });
  assert.deepEqual(parseUploadName("clx9abc.bin", "releases"), { id: "clx9abc" });
  assert.equal(parseUploadName("clx9abc.thumb.webp", "releases"), null);
  assert.equal(parseUploadName("notas.txt", "root"), null);
  assert.equal(parseUploadName("..webp", "root"), null);
  assert.deepEqual(parseUploadName("clx9abc.webp.123.tmp", "root"), { tmp: true });
  assert.equal(isInside("/a/b", "/a/b/c.webp"), true);
  assert.equal(isInside("/a/b", "/a/c.webp"), false);
  assert.equal(isInside("/a/b", "/a/b/../c"), false);
});

test("huérfanos: solo borra lo no referenciado, viejo y regular; respeta backups y enlaces", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "pz-up-"));
  try {
    const old = new Date(Date.now() - 3 * 24 * 3600 * 1000);
    const put = async (rel: string, age: Date | null = old) => {
      const p = path.join(dir, rel);
      await mkdir(path.dirname(p), { recursive: true });
      await writeFile(p, "x");
      if (age) await utimes(p, age, age);
      return p;
    };
    const keepFull = await put("keep1.webp");
    const keepThumb = await put("keep1.thumb.webp");
    const orphanFull = await put("gone1.webp");
    const orphanThumb = await put("gone1.thumb.webp");
    const orphanBin = await put("gone2.bin");
    const fresh = await put("fresh1.webp", null); // recién subido: no se toca
    const staleTmp = await put("keep1.webp.99.tmp");
    const unknown = await put("README.txt");
    const backup = await put("backups/pizarro-backup-20261022T031500Z.pzbak");
    const relKeep = await put("releases/rel1.webp");
    const relOrphan = await put("releases/rel2.webp");
    // Enlace simbólico a un fichero fuera de la carpeta: nunca se sigue ni se borra.
    const outside = await mkdtemp(path.join(tmpdir(), "pz-out-"));
    await writeFile(path.join(outside, "secret.webp"), "secreto");
    await symlink(path.join(outside, "secret.webp"), path.join(dir, "link1.webp"));

    const known = { attachments: new Set(["keep1"]), releaseAttachments: new Set(["rel1"]) };
    const dry = await cleanOrphanFiles(dir, known, { dryRun: true });
    assert.equal(dry.deleted, 0);
    assert.equal(dry.orphans, 5); // gone1 x2, gone2, tmp, rel2

    const report = await cleanOrphanFiles(dir, known);
    assert.equal(report.deleted, 5);
    const exists = (p: string) => stat(p).then(() => true, () => false);
    for (const p of [keepFull, keepThumb, fresh, unknown, backup, relKeep]) assert.equal(await exists(p), true, p);
    for (const p of [orphanFull, orphanThumb, orphanBin, staleTmp, relOrphan]) assert.equal(await exists(p), false, p);
    assert.equal(await exists(path.join(outside, "secret.webp")), true);
    assert.equal(await exists(path.join(dir, "link1.webp")), true);
    await rm(outside, { recursive: true, force: true });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("huérfanos: si casi todo parece huérfano (BD equivocada) no borra nada", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "pz-up-"));
  try {
    const old = new Date(Date.now() - 3 * 24 * 3600 * 1000);
    for (let i = 0; i < 60; i++) {
      const p = path.join(dir, `a${i}.webp`);
      await writeFile(p, "x");
      await utimes(p, old, old);
    }
    const report = await cleanOrphanFiles(dir, { attachments: new Set(), releaseAttachments: new Set() });
    assert.equal(report.aborted, true);
    assert.equal(report.deleted, 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("canales SSE: revocar por usuario, sesión y proyecto, y límite por usuario", () => {
  let closed = 0;
  const open = (userId: string, projectId: string, sessionId: string) => registerStream({ userId, projectId, sessionId, close: () => void closed++ });
  const offA = open("u1", "p1", "s1");
  open("u1", "p2", "s2");
  open("u2", "p1", "s3");
  assert.equal(openStreamCount("u1"), 2);
  assert.equal(revokeSessionStreams("s2"), 1);
  assert.equal(revokeProjectStreams("p1"), 2);
  assert.equal(openStreamCount(), 0);
  assert.equal(closed, 3);
  offA?.(); // desregistrar uno ya cerrado es inocuo

  for (let i = 0; i < MAX_STREAMS_PER_USER; i++) assert.ok(open("u3", "p1", `x${i}`));
  assert.equal(open("u3", "p1", "extra"), null, "el undécimo canal se rechaza");
  assert.equal(revokeUserStreams("u3"), MAX_STREAMS_PER_USER);
  assert.ok(open("u3", "p1", "again"));
  revokeUserStreams("u3");
});
