// Tras perder el volumen o la base de datos, la primera copia automática es de una instalación casi vacía: no debe
// llegar al destino externo ni, con su retención, borrar la copia buena (y los ficheros que solo esa nombraba).
// También: BACKUP_PAUSE=1 detiene las tareas automáticas y «Copiar ahora» (force) sube igualmente.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import "./helpers";

const { backupPaused, createBackup, dailyBackupJob, externalBackupJob, listBackups, readStatus, syncExternal } = await import("../../src/lib/backup");
const { DirDestination, listObjectKeys, listStems, readManifest } = await import("../../src/lib/backup-dest");

const dirs: string[] = [];
const tmp = async () => {
  const d = await mkdtemp(path.join(tmpdir(), "pz-shrink-"));
  dirs.push(d);
  return d;
};
const VARS = ["UPLOAD_DIR", "BACKUP_KEY", "BACKUP_EXTERNAL_DIR", "BACKUP_LOCAL_FILES", "BACKUP_PAUSE", "BACKUP_S3_ENDPOINT", "BACKUP_S3_BUCKET", "BACKUP_S3_ACCESS_KEY_ID", "BACKUP_S3_SECRET_ACCESS_KEY", "BACKUP_S3_PREFIX"];
let external: string;
const key = randomBytes(32);

before(async () => {
  for (const k of VARS) delete process.env[k];
  external = await tmp();
  Object.assign(process.env, { UPLOAD_DIR: await tmp(), BACKUP_KEY: key.toString("base64"), BACKUP_EXTERNAL_DIR: external });
});

after(async () => {
  for (const k of VARS) delete process.env[k];
  for (const d of dirs) await rm(d, { recursive: true, force: true });
});

const nextSecond = () => new Promise((r) => setTimeout(r, 1100)); // los nombres de las copias van por segundos

describe("copia casi vacía tras perder los datos", () => {
  test("no se sube ni se poda; con BACKUP_PAUSE no se intenta; con «Copiar ahora» sí, sin perder la buena", async () => {
    // Instalación con datos: 30 ficheros. Primera copia y subida, correctas.
    for (let i = 0; i < 30; i++) await writeFile(path.join(process.env.UPLOAD_DIR!, `a${i}.bin`), randomBytes(200));
    const good = await createBackup();
    assert.equal(good.ok, true, good.error);
    assert.equal(good.files, 30);
    const first = await syncExternal();
    assert.deepEqual(first.map((r) => [r.ok, r.uploaded]), [[true, 30]]);
    const dest = new DirDestination("dir", external, true);
    const goodStem = good.file!.replace(/\.pzbak$/, "");
    const goodObjects = await listObjectKeys(dest);

    // «Se pierde el volumen»: UPLOAD_DIR nueva y vacía (sin status.json), mismo destino externo.
    process.env.UPLOAD_DIR = await tmp();
    await nextSecond();
    const empty = await createBackup();
    assert.equal(empty.ok, true, empty.error);
    assert.equal(empty.files, 0);
    const blocked = await syncExternal();
    assert.equal(blocked.length, 1);
    assert.equal(blocked[0]!.ok, false);
    assert.match(blocked[0]!.error ?? "", /No se sube la copia .*0 ficheros.*tiene 30.*Copiar ahora a destino externo/);
    assert.deepEqual((await listStems(dest)).map((s) => s.stem), [goodStem], "el destino sigue con la copia buena y nada más");
    assert.deepEqual(await listObjectKeys(dest), goodObjects, "ningún fichero borrado");
    assert.equal((await readStatus()).external?.dir?.last?.ok, false);
    // La tarea horaria lo reintenta y falla (queda en Tareas de mantenimiento y en los logs).
    await assert.rejects(externalBackupJob(), /No se sube la copia/);

    // BACKUP_PAUSE=1: ni copia diaria ni subida (aunque la copia «tocaría»).
    process.env.BACKUP_PAUSE = "1";
    assert.equal(backupPaused(), true);
    const count = (await listBackups()).length;
    await dailyBackupJob(Date.now() + 2 * 24 * 3600 * 1000);
    assert.equal((await listBackups()).length, count, "en pausa no se crea copia");
    await externalBackupJob(); // en pausa no se intenta: no falla
    delete process.env.BACKUP_PAUSE;
    assert.equal(backupPaused({ BACKUP_PAUSE: "0" }), false);

    // «Copiar ahora a destino externo» (force): se sube; la buena se conserva (las 3 más recientes) con sus ficheros.
    const forced = await syncExternal({ force: true });
    assert.deepEqual(forced.map((r) => r.ok), [true], forced[0]?.error);
    const emptyStem = empty.file!.replace(/\.pzbak$/, "");
    assert.deepEqual((await listStems(dest)).map((s) => s.stem), [emptyStem, goodStem]);
    assert.deepEqual(await listObjectKeys(dest), goodObjects, "los objetos de la copia buena siguen");
    assert.equal((await readManifest(dest, goodStem, key)).fileCount, 30);
  });
});
