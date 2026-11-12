// Comprobaciones de contraseña: como mucho unas pocas a la vez (semáforo con cola corta y espera máxima) y fuera del hilo
// principal (hilos de trabajo con bcryptjs, compatibles con los hashes que ya hay guardados).
import assert from "node:assert/strict";
import { after, describe, test } from "node:test";
import bcrypt from "bcryptjs";
import { isSemaphoreFull, Semaphore, SemaphoreFullError } from "../src/lib/semaphore";
import { bcryptWorkersEnabled, closeBcryptWorkers } from "../src/lib/bcrypt-pool";
import {
  dummyVerify, hashPassword, isPasswordBusy, PASSWORD_CHECKS_AT_ONCE, PASSWORD_QUEUE, PasswordBusyError, passwordCheckStats, verifyPassword,
} from "../src/lib/password";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

after(() => closeBcryptWorkers());

describe("Semaphore", () => {
  test("como mucho `max` a la vez; las demás esperan su turno en orden", async () => {
    const sem = new Semaphore({ max: 2, maxQueue: 5, maxWaitMs: 1000 });
    let running = 0;
    let peak = 0;
    const order: number[] = [];
    await Promise.all(
      [0, 1, 2, 3, 4].map((i) =>
        sem.run(async () => {
          running++;
          peak = Math.max(peak, running);
          await sleep(10);
          order.push(i);
          running--;
        }),
      ),
    );
    assert.equal(peak, 2);
    assert.deepEqual(order, [0, 1, 2, 3, 4]);
    assert.deepEqual(sem.stats, { active: 0, waiting: 0 });
  });

  test("con la cola llena rechaza al momento; si la espera se alarga, también", async () => {
    const sem = new Semaphore({ max: 1, maxQueue: 1, maxWaitMs: 40 });
    let release!: () => void;
    const holding = sem.run(() => new Promise<void>((r) => (release = r)));
    const queued = sem.run(async () => "tarde");
    await assert.rejects(sem.run(async () => "no cabe"), (e: unknown) => e instanceof SemaphoreFullError && e.reason === "queue");
    await assert.rejects(queued, (e: unknown) => e instanceof SemaphoreFullError && e.reason === "timeout");
    release();
    await holding;
    assert.equal(await sem.run(async () => "libre"), "libre");
    assert.deepEqual(sem.stats, { active: 0, waiting: 0 });
  });

  test("los rechazos se reconocen aunque la clase venga de otro paquete de Next (semáforo compartido en globalThis)", () => {
    const foreign = Object.assign(new Error("Cola llena"), { name: "SemaphoreFullError" });
    assert.equal(isSemaphoreFull(foreign), true);
    assert.equal(isSemaphoreFull(new Error("otro")), false);
    assert.equal(isPasswordBusy(Object.assign(new Error("x"), { code: "password_busy" })), true);
    assert.equal(isPasswordBusy(new PasswordBusyError()), true);
    assert.equal(isPasswordBusy(new Error("x")), false);
  });

  test("bounded: false espera sin tope de cola ni de tiempo (y un error de la tarea libera el hueco)", async () => {
    const sem = new Semaphore({ max: 1, maxQueue: 0, maxWaitMs: 5 });
    const results = await Promise.allSettled([
      sem.run(async () => {
        await sleep(30);
        throw new Error("falla");
      }),
      sem.run(async () => "esperó", { bounded: false }),
    ]);
    assert.equal(results[0].status, "rejected");
    assert.deepEqual(results[1], { status: "fulfilled", value: "esperó" });
    assert.deepEqual(sem.stats, { active: 0, waiting: 0 });
  });
});

describe("contraseñas", () => {
  test("los hilos de trabajo están disponibles en las pruebas (bcryptjs se encuentra desde la carpeta de trabajo)", () => {
    assert.equal(bcryptWorkersEnabled(), true);
  });

  test("compatibles con los hashes existentes: lo calculado en el hilo principal se comprueba en los hilos y al revés", async () => {
    const legacy = await bcrypt.hash("una-clave-larga-123", 11);
    assert.equal(await verifyPassword("una-clave-larga-123", legacy), true);
    assert.equal(await verifyPassword("otra-clave-larga-123", legacy), false);
    // Hashes $2a$ (bcryptjs 2 y otras librerías) también.
    assert.equal(await verifyPassword("una-clave-larga-123", legacy.replace(/^\$2b\$/, "$2a$")), true);
    const fresh = await hashPassword("clave-nueva-12345");
    assert.match(fresh, /^\$2[ab]\$11\$/);
    assert.equal(bcrypt.compareSync("clave-nueva-12345", fresh), true);
    // Un hash con formato inválido no lanza: no coincide (como antes).
    assert.equal(await verifyPassword("x", "!"), false);
    assert.equal(await dummyVerify("tablon-dummy-password"), true, "el hash de relleno es de coste 11 y válido");
    assert.equal(await dummyVerify("cualquier-otra"), false);
  });

  test("no bloquean el bucle de eventos: 8 comprobaciones a la vez dejan responder al servidor", async () => {
    const hash = await hashPassword("una-clave-larga-123");
    let maxGap = 0;
    let last = performance.now();
    const timer = setInterval(() => {
      const now = performance.now();
      maxGap = Math.max(maxGap, now - last - 5);
      last = now;
    }, 5);
    const results = await Promise.all(Array.from({ length: 8 }, () => verifyPassword("una-clave-larga-123", hash)));
    clearInterval(timer);
    assert.ok(results.every(Boolean));
    // En el hilo principal, 8 comprobaciones dejaban el servidor parado ~1,5 s; en los hilos, apenas unos ms.
    assert.ok(maxGap < 400, `el bucle de eventos estuvo parado ${maxGap.toFixed(0)} ms`);
  });

  test("tope: como mucho PASSWORD_CHECKS_AT_ONCE a la vez y una cola corta; lo que no cabe, PasswordBusyError", async () => {
    const hash = await hashPassword("una-clave-larga-123");
    const total = PASSWORD_CHECKS_AT_ONCE + PASSWORD_QUEUE + 3;
    let peak = 0;
    const probe = setInterval(() => (peak = Math.max(peak, passwordCheckStats().active)), 2);
    const results = await Promise.allSettled(Array.from({ length: total }, () => verifyPassword("una-clave-larga-123", hash)));
    clearInterval(probe);
    const busy = results.filter((r) => r.status === "rejected");
    assert.equal(busy.length, 3);
    for (const r of busy) {
      const err = (r as PromiseRejectedResult).reason;
      assert.ok(err instanceof PasswordBusyError);
      assert.equal(err.message, "Demasiados intentos a la vez, prueba en unos segundos.");
    }
    assert.ok(results.filter((r) => r.status === "fulfilled").every((r) => (r as PromiseFulfilledResult<boolean>).value));
    assert.ok(peak <= PASSWORD_CHECKS_AT_ONCE, `pico de ${peak}`);
    assert.deepEqual(passwordCheckStats(), { active: 0, waiting: 0 });
  });

  test("con BCRYPT_WORKERS=0 se calcula en el hilo principal (mismo resultado)", async () => {
    process.env.BCRYPT_WORKERS = "0";
    try {
      assert.equal(bcryptWorkersEnabled(), false);
      const hash = await hashPassword("una-clave-larga-123");
      assert.equal(await verifyPassword("una-clave-larga-123", hash), true);
      assert.equal(await verifyPassword("otra", hash), false);
    } finally {
      delete process.env.BCRYPT_WORKERS;
    }
  });
});
