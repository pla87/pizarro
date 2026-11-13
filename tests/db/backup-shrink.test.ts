// Tras perder el volumen o la base de datos, la primera copia automática es de una instalación casi vacía: no debe
// llegar al destino externo ni, con su retención, borrar la copia buena (y los ficheros que solo esa nombraba).
// También: BACKUP_PAUSE=1 detiene las tareas automáticas y «Copiar ahora» (force) sube igualmente.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { db, waitForLockWaiter } from "./helpers";

const { acceptBackupShrink, backupPaused, createBackup, dailyBackupJob, externalBackupJob, listBackups, readStatus, syncExternal } = await import("../../src/lib/backup");
const { computeBackupAlert } = await import("../../src/lib/backup-alert");
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

describe("copias locales sin destino externo: las copias vacías no desplazan la buena", () => {
  test("la retención conserva la última buena, avisa al administrador y, al confirmar la reducción, vuelve a la normal", async () => {
    delete process.env.BACKUP_EXTERNAL_DIR;
    process.env.UPLOAD_DIR = await tmp();
    for (let i = 0; i < 30; i++) await writeFile(path.join(process.env.UPLOAD_DIR, `b${i}.bin`), randomBytes(150));
    const good = await createBackup();
    assert.equal(good.ok, true, good.error);
    const goodStem = good.file!.replace(/\.pzbak$/, "");
    const local = new DirDestination("local", path.join(process.env.UPLOAD_DIR, "backups"), true);
    const goodObjects = await listObjectKeys(local);
    assert.equal(goodObjects.size, 30);
    assert.equal((await readStatus()).shrink, undefined);
    assert.equal((await computeBackupAlert()).active, false);

    // Se pierden los ficheros (la carpeta de copias sigue): cuatro copias seguidas casi vacías. Sin la protección, la
    // retención (14 diarias, 6 mensuales y las 3 más recientes; todas del mismo día) ya habría borrado la buena.
    for (let i = 0; i < 30; i++) await rm(path.join(process.env.UPLOAD_DIR, `b${i}.bin`));
    const empties: string[] = [];
    for (let i = 0; i < 4; i++) {
      await nextSecond();
      const r = await createBackup();
      assert.equal(r.ok, true, r.error);
      assert.equal(r.files, 0);
      empties.push(r.file!.replace(/\.pzbak$/, ""));
    }
    const stems = (await listStems(local)).map((s) => s.stem);
    assert.ok(stems.includes(goodStem), "la copia buena sigue");
    assert.deepEqual(stems.filter((s) => s !== goodStem), empties.slice(-3).reverse(), "de las vacías, solo las 3 más recientes");
    assert.deepEqual(await listObjectKeys(local), goodObjects, "con todos sus ficheros");
    assert.equal((await readManifest(local, goodStem, key)).fileCount, 30);

    // Aviso al administrador (en el menú, la página y por email), con lo que se redujo y la copia buena.
    const status = await readStatus();
    assert.equal(status.shrink?.goodStem, goodStem);
    assert.equal(status.shrink?.stem, empties.at(-1));
    assert.deepEqual([status.shrink?.what, status.shrink?.local, status.shrink?.remote], ["files", 0, 30]);
    const alert = await computeBackupAlert();
    assert.deepEqual([alert.active, alert.reason, alert.shrink?.goodStem], [true, "shrunk", goodStem]);
    assert.ok(alert.shrink?.goodAt, "con la fecha de la copia buena");
    assert.ok(Object.keys(status.copies ?? {}).includes(goodStem), "el resumen de cada copia queda en status.json");

    // La confirmación es de la copia que vio el administrador: si el aviso que tiene delante ya no es el vigente (ha
    // llegado otra copia), no se confirma nada.
    await assert.rejects(acceptBackupShrink(undefined, { stem: empties.at(-2)!, goodStem }), /Ha llegado una copia nueva: revisa el aviso otra vez\./);
    await assert.rejects(acceptBackupShrink(undefined, { stem: empties.at(-1)!, goodStem: empties[0]! }), /Ha llegado una copia nueva/);
    assert.equal((await readStatus()).shrink?.stem, empties.at(-1), "el aviso sigue");
    // Reducción intencionada: se confirma, el aviso desaparece y la buena vuelve a la retención normal.
    assert.equal(await acceptBackupShrink(undefined, { stem: empties.at(-1)!, goodStem }), empties.at(-1));
    assert.equal(await acceptBackupShrink(), null, "sin aviso no hay nada que confirmar");
    assert.equal((await computeBackupAlert()).active, false);
    await nextSecond();
    const next = await createBackup();
    assert.equal(next.ok, true, next.error);
    assert.equal((await readStatus()).shrink, undefined, "comparada desde la reducción aceptada, la nueva es buena");
    assert.ok(!(await listStems(local)).some((s) => s.stem === goodStem), "la antigua ya no se conserva siempre");
    assert.equal((await listObjectKeys(local)).size, 0, "y sus ficheros se borran con ella");
  });
});

describe("confirmar la reducción mientras se hace una copia", () => {
  test("al terminar esa copia el aviso no vuelve", async () => {
    delete process.env.BACKUP_EXTERNAL_DIR;
    process.env.UPLOAD_DIR = await tmp();
    for (let i = 0; i < 30; i++) await writeFile(path.join(process.env.UPLOAD_DIR, `c${i}.bin`), randomBytes(150));
    const good = await createBackup();
    assert.equal(good.ok, true, good.error);
    for (let i = 0; i < 30; i++) await rm(path.join(process.env.UPLOAD_DIR, `c${i}.bin`));
    await nextSecond();
    const empty = await createBackup();
    assert.equal(empty.ok, true, empty.error);
    const shrink = (await readStatus()).shrink;
    assert.equal(shrink?.stem, empty.file!.replace(/\.pzbak$/, ""));

    // Otra copia en marcha: su volcado se queda esperando a una tabla bloqueada; mientras, el administrador confirma.
    await nextSecond();
    let running: Promise<{ ok: boolean; error?: string }> | null = null;
    await db.$transaction(async (tx) => {
      await tx.$executeRaw`LOCK TABLE "Label" IN ACCESS EXCLUSIVE MODE`;
      running = createBackup();
      await waitForLockWaiter();
      assert.equal(await acceptBackupShrink(undefined, { stem: shrink!.stem, goodStem: shrink!.goodStem }), shrink!.stem);
      assert.equal((await readStatus()).shrink, undefined);
    }, { timeout: 30_000 });
    const during = await running!;
    assert.equal(during.ok, true, during.error);
    const after = await readStatus();
    assert.equal(after.shrink, undefined, "la copia que estaba en marcha no vuelve a poner el aviso ya confirmado");
    assert.equal(after.shrinkAccepted, shrink!.stem);
    assert.equal((await computeBackupAlert()).active, false);
  });
});
