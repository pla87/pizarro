// Comprobaciones de contraseña: como mucho unas pocas a la vez (semáforo con cola corta y espera máxima) y fuera del hilo
// principal (hilos de trabajo con bcryptjs, compatibles con los hashes que ya hay guardados).
import assert from "node:assert/strict";
import { after, describe, test } from "node:test";
import bcrypt from "bcryptjs";
import { isSemaphoreFull, Semaphore, SemaphoreFullError } from "../src/lib/semaphore";
import { bcryptPoolStats, bcryptWorkersEnabled, closeBcryptWorkers, runBcrypt, type BcryptOp } from "../src/lib/bcrypt-pool";
import {
  dummyVerify, hashPassword, isPasswordBusy, PASSWORD_CHECKS_AT_ONCE, PASSWORD_MAX_WAIT_MS, PASSWORD_BUSY_MESSAGE, PASSWORD_QUEUE, PasswordBusyError, passwordCheckStats, verifyPassword,
} from "../src/lib/password";
import { rateLimit, rateLimitReached } from "../src/lib/rate-limit";

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

  test("la cola cuenta solo las esperas con tope, y deja sitio cuando una se agota o entra", async () => {
    const sem = new Semaphore({ max: 1, maxQueue: 2, maxWaitMs: 30 });
    let release!: () => void;
    const holding = sem.run(() => new Promise<void>((r) => (release = r)));
    const unbounded = sem.run(async () => "sin tope", { bounded: false });
    const a = sem.run(async () => "a");
    const b = sem.run(async () => "b");
    await assert.rejects(sem.run(async () => "c"), (e: unknown) => e instanceof SemaphoreFullError && e.reason === "queue");
    await assert.rejects(a, (e: unknown) => e instanceof SemaphoreFullError && e.reason === "timeout");
    await assert.rejects(b, (e: unknown) => e instanceof SemaphoreFullError && e.reason === "timeout");
    // Las dos agotadas dejan su sitio: caben otras dos.
    const d = sem.run(async () => "d");
    const e = sem.run(async () => "e");
    assert.deepEqual(sem.stats, { active: 1, waiting: 3 });
    release();
    assert.deepEqual(await Promise.all([holding, unbounded, d, e]), [undefined, "sin tope", "d", "e"]);
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
    let results: boolean[];
    try {
      results = await Promise.all(Array.from({ length: 8 }, () => verifyPassword("una-clave-larga-123", hash)));
    } finally {
      // Siempre, también si falla: un intervalo vivo deja colgado el proceso de pruebas.
      clearInterval(timer);
    }
    assert.ok(results.every(Boolean));
    // En el hilo principal, 8 comprobaciones dejaban el servidor parado ~1,5 s; en los hilos, apenas unos ms.
    assert.ok(maxGap < 400, `el bucle de eventos estuvo parado ${maxGap.toFixed(0)} ms`);
  });

  test("tope: como mucho PASSWORD_CHECKS_AT_ONCE a la vez y la cola llena; lo que no cabe, PasswordBusyError al momento", async () => {
    // Hash de coste 4 (~1 ms): lo que se prueba es el tope, no lo que tarda bcrypt.
    const hash = bcrypt.hashSync("una-clave-larga-123", 4);
    // Los huecos, ocupados hasta soltarlos (el semáforo compartido de password.ts, en globalThis).
    const sem = (globalThis as unknown as { __pzPasswordSem: Semaphore }).__pzPasswordSem;
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const holders = Array.from({ length: PASSWORD_CHECKS_AT_ONCE }, () => sem.run(() => gate));
    let peak = 0;
    const probe = setInterval(() => (peak = Math.max(peak, passwordCheckStats().active)), 2);
    let results: PromiseSettledResult<boolean>[];
    try {
      const pending = Array.from({ length: PASSWORD_QUEUE + 3 }, () => verifyPassword("una-clave-larga-123", hash));
      const settled = Promise.allSettled(pending);
      // Las 3 que no caben se rechazan ya, sin esperar a que se libere nada.
      const early = await Promise.race([Promise.allSettled(pending.slice(PASSWORD_QUEUE)), new Promise((r) => setTimeout(() => r("tarde"), 200))]);
      assert.notEqual(early, "tarde", "las que no caben se rechazan al momento");
      release();
      await Promise.all(holders);
      results = await settled;
    } finally {
      // Siempre, también si una comprobación falla: los huecos sin soltar o el intervalo vivo dejarían colgado el proceso.
      release();
      clearInterval(probe);
    }
    const busy = results.filter((r) => r.status === "rejected");
    assert.equal(busy.length, 3);
    for (const r of busy) {
      const err = (r as PromiseRejectedResult).reason;
      assert.ok(err instanceof PasswordBusyError);
      assert.equal(err.message, PASSWORD_BUSY_MESSAGE);
    }
    assert.ok(results.filter((r) => r.status === "fulfilled").every((r) => (r as PromiseFulfilledResult<boolean>).value));
    assert.ok(peak <= PASSWORD_CHECKS_AT_ONCE, `pico de ${peak}`);
    assert.deepEqual(passwordCheckStats(), { active: 0, waiting: 0 });
  });

  test("la cola cabe en la espera máxima: una ráfaga de 20 accesos a la vez (una clase entera) entra sin rechazos", async () => {
    // La cola es lo que se atiende en PASSWORD_MAX_WAIT_MS (3 s / 0,2 s × 2 = 30): antes eran 8 y aquí se rechazaban 10.
    assert.equal(PASSWORD_QUEUE, Math.floor((PASSWORD_MAX_WAIT_MS / 200) * PASSWORD_CHECKS_AT_ONCE));
    assert.ok(PASSWORD_QUEUE >= 24 && PASSWORD_QUEUE <= 30, `cola de ${PASSWORD_QUEUE}`);
    // Coste 10 (la mitad que el real) para que la prueba no dependa de lo cargada que esté la máquina.
    const hash = bcrypt.hashSync("una-clave-larga-123", 10);
    const started = performance.now();
    const results = await Promise.allSettled(Array.from({ length: 20 }, () => verifyPassword("una-clave-larga-123", hash)));
    const rejected = results.filter((r) => r.status === "rejected");
    assert.equal(rejected.length, 0, `${rejected.length} rechazadas en ${(performance.now() - started).toFixed(0)} ms`);
    assert.deepEqual(passwordCheckStats(), { active: 0, waiting: 0 });
  });

  test("verifyPasswordCounted: con el servidor ocupado devuelve el intento ya contado; con respuesta, cuenta", async () => {
    const { verifyPasswordCounted } = await import("../src/lib/password");
    const hash = bcrypt.hashSync("una-clave-larga-123", 4);
    const key = `password:prueba-${Math.random()}`;
    const sem = (globalThis as unknown as { __pzPasswordSem: Semaphore }).__pzPasswordSem;
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const full = Array.from({ length: PASSWORD_CHECKS_AT_ONCE + PASSWORD_QUEUE }, () => sem.run(() => gate));
    try {
      assert.equal(rateLimit(key, 1, 60_000), true);
      await assert.rejects(verifyPasswordCounted("una-clave-larga-123", hash, key), PasswordBusyError);
      assert.equal(rateLimitReached(key, 1), false, "el intento sin comprobar no cuenta");
    } finally {
      release();
      await Promise.allSettled(full);
    }
    assert.equal(rateLimit(key, 1, 60_000), true);
    assert.equal(await verifyPasswordCounted("otra-clave-larga-123", hash, key), false);
    assert.equal(rateLimitReached(key, 1), true, "un intento comprobado sí cuenta");
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

describe("hilos de bcrypt: fallos", () => {
  const sleepOp = { op: "hash", plain: "una-clave-larga-123", cost: 20 } as const; // minutos: solo acaba si se termina
  const pool = () => (globalThis as unknown as { __pzBcryptPool: { bcryptPath?: unknown } }).__pzBcryptPool;

  test("un hilo que no responde a tiempo se termina, libera su hueco y la operación sale en el hilo principal", async () => {
    await closeBcryptWorkers();
    const started = performance.now();
    assert.equal(await runBcrypt(sleepOp, async () => "principal", { timeoutMs: 150 }), "principal");
    assert.ok(performance.now() - started < 2_000, "no espera a que termine el hilo");
    assert.deepEqual(bcryptPoolStats(), { workers: 0, busy: 0, failures: 1 });
    // El siguiente usa un hilo nuevo.
    const hash = await hashPassword("una-clave-larga-123");
    assert.equal(await verifyPassword("una-clave-larga-123", hash), true);
    assert.equal(bcryptPoolStats().busy, 0);
    await closeBcryptWorkers();
  });

  test("un error al enviar la operación al hilo cae al hilo principal (no es un error de bcrypt)", async () => {
    await closeBcryptWorkers();
    // Una función no se puede pasar a otro hilo: postMessage lanza en el acto (DataCloneError).
    const job = { op: "compare", plain: "x", hash: "y", extra: () => 0 } as unknown as BcryptOp;
    assert.equal(await runBcrypt(job, async () => "principal"), "principal");
    assert.equal(bcryptPoolStats().busy, 0);
    await closeBcryptWorkers();
  });

  test("si no se puede crear el hilo (new Worker lanza), al hilo principal", async () => {
    await closeBcryptWorkers();
    const saved = pool().bcryptPath;
    // Un workerData que no se puede copiar hace que new Worker lance en el acto, como sin memoria o sin hilos.
    pool().bcryptPath = Symbol("no se puede copiar");
    try {
      assert.equal(await runBcrypt({ op: "compare", plain: "x", hash: "y" }, async () => "principal"), "principal");
      assert.deepEqual(bcryptPoolStats(), { workers: 0, busy: 0, failures: 1 });
    } finally {
      pool().bcryptPath = saved;
      await closeBcryptWorkers();
    }
    assert.equal(bcryptWorkersEnabled(), true);
  });
});
