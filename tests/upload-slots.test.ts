import assert from "node:assert/strict";
import { after, beforeEach, describe, test } from "node:test";
import { acquireUploadSlot, declaredLength, SMALL_BODY_BYTES, uploadPerUserCap, withUploadCapHeader, IMPORT_MAX_TOTAL_MS, MAX_UPLOADS_AT_ONCE, readBodyLimited, resetUploadSlots, UPLOAD_MAX_TOTAL_MS, UploadTooSlowError, uploadTotalMs } from "../src/lib/upload-slots";
import { ACTIVE_WINDOW_MS, forgetUserActivity, noteUserActivity, recentlyActiveUsers } from "../src/lib/user-activity";

describe("acquireUploadSlot", () => {
  beforeEach(() => resetUploadSlots());
  after(() => resetUploadSlots());

  /** Promesa con su estado a la vista (para saber si una espera ya ha recibido su hueco sin pausas). */
  const track = (p: Promise<(() => void) | null>) => {
    const t = { done: false, value: undefined as (() => void) | null | undefined, p };
    void p.then((v) => { t.done = true; t.value = v; });
    return t;
  };
  const tick = () => new Promise((r) => setImmediate(r));

  test("concede como mucho MAX_UPLOADS_AT_ONCE a la vez; las demás esperan su turno o se rinden", async () => {
    const held = await Promise.all(Array.from({ length: MAX_UPLOADS_AT_ONCE }, () => acquireUploadSlot("u1")));
    assert.ok(held.every((r) => typeof r === "function"));
    assert.equal(await acquireUploadSlot("u1", 20), null); // sin hueco a tiempo
    const waiting = acquireUploadSlot("u1", 1000);
    held[0]!();
    held[0]!(); // doble liberación: no libera dos huecos
    const next = await waiting; // recibe el hueco liberado
    assert.ok(next);
    assert.equal(await acquireUploadSlot("u1", 20), null);
    next();
    for (const r of held.slice(1)) r!();
    const free = await Promise.all(Array.from({ length: MAX_UPLOADS_AT_ONCE }, () => acquireUploadSlot("u1", 20)));
    assert.ok(free.every(Boolean));
    for (const r of free) r!();
  });

  test("tope por persona para la cabecera: 3 con una sola persona activa, 1 con dos (también en las respuestas)", async () => {
    noteUserActivity("a");
    assert.equal(uploadPerUserCap(), 3);
    assert.equal(withUploadCapHeader(new Response("x", { status: 201 })).headers.get("X-Pizarro-Upload-Per-User"), "3");
    noteUserActivity("b");
    assert.equal(uploadPerUserCap(), 1);
    const busy = withUploadCapHeader(Response.json({ code: "upload_busy" }, { status: 429, headers: { "Retry-After": "5" } }));
    assert.equal(busy.headers.get("X-Pizarro-Upload-Per-User"), "1");
    assert.equal(busy.headers.get("Retry-After"), "5");
    // La actividad de b caduca a los 5 min: vuelve a 3.
    assert.equal(uploadPerUserCap(Date.now() + ACTIVE_WINDOW_MS + 1), 3);
  });

  test("un cuerpo pequeño (Content-Length < 256 KB) no espera a otra subida propia, pero sí cuenta para el tope global", async () => {
    assert.equal(SMALL_BODY_BYTES, 256 * 1024);
    noteUserActivity("b"); // otra persona activa: a sube de una en una
    const slow = await acquireUploadSlot("a", 20); // adjunto lento de a
    assert.ok(slow);
    // Su JSON de importar tareas entra sin esperar; sin Content-Length o con uno grande, no.
    const json = await acquireUploadSlot("a", 20, { declaredBytes: 2_000 });
    assert.ok(json);
    assert.equal(await acquireUploadSlot("a", 20, { declaredBytes: null }), null);
    assert.equal(await acquireUploadSlot("a", 20, { declaredBytes: SMALL_BODY_BYTES }), null);
    // No ocupa el hueco por persona de a: b sigue entrando y ocupa el tercero global.
    const b1 = await acquireUploadSlot("b", 20);
    assert.ok(b1);
    // Global lleno (3): ni siquiera uno pequeño entra.
    assert.equal(await acquireUploadSlot("c", 20, { declaredBytes: 10 }), null);
    json(); // al soltar el pequeño no se descuenta el adjunto de a
    json();
    assert.equal(await acquireUploadSlot("a", 20), null);
    slow();
    const a2 = await acquireUploadSlot("a", 20);
    assert.ok(a2);
    a2();
    b1();
  });

  test("una persona sola usa los 3 huecos", async () => {
    const held = await Promise.all(Array.from({ length: 3 }, () => acquireUploadSlot("solo", 20)));
    assert.equal(MAX_UPLOADS_AT_ONCE, 3);
    assert.ok(held.every(Boolean));
    for (const r of held) r!();
  });

  test("con dos personas activas, cada una sube de una en una: la segunda de la primera espera aunque haya huecos", async () => {
    noteUserActivity("b"); // b solo navega (petición con sesión): ya cuenta como activa
    const a1 = await acquireUploadSlot("a", 20);
    assert.ok(a1);
    const a2 = track(acquireUploadSlot("a", 5000));
    const b1 = await acquireUploadSlot("b", 20); // b no espera: hay huecos y no tiene ninguna en curso
    assert.ok(b1);
    await tick();
    assert.equal(a2.done, false);
    assert.equal(await acquireUploadSlot("b", 20), null); // la segunda de b tampoco entra
    a1();
    const got = await a2.p; // al liberar la suya, a2 recibe el turno
    assert.ok(got);
    got();
    b1();
  });

  test("al liberar, el hueco pasa a quien llegó después sin ninguna en curso, no a la cola de quien ya tiene una", async () => {
    // a estaba sola y tiene los 3 huecos, con 2 más en cola.
    const aHeld = await Promise.all(Array.from({ length: 3 }, () => acquireUploadSlot("a", 20)));
    assert.ok(aHeld.every(Boolean));
    const a4 = track(acquireUploadSlot("a", 5000));
    const a5 = track(acquireUploadSlot("a", 5000));
    // Llega b (ahora hay dos activas: tope de 1 por persona) y después c.
    const b1 = track(acquireUploadSlot("b", 5000));
    const c1 = track(acquireUploadSlot("c", 5000));
    await tick();
    assert.ok(!a4.done && !a5.done && !b1.done && !c1.done);
    aHeld[0]!(); // a sigue con 2 (más que su tope): el hueco es para b, la primera que puede usarlo
    await tick();
    assert.ok(b1.done && b1.value);
    assert.ok(!a4.done && !a5.done && !c1.done);
    aHeld[1]!(); // a con 1: sigue en su tope; le toca a c
    await tick();
    assert.ok(c1.done && c1.value);
    assert.ok(!a4.done && !a5.done);
    aHeld[2]!(); // a sin ninguna: ahora sí, su siguiente en cola (a4, no a5)
    await tick();
    assert.ok(a4.done && a4.value);
    assert.equal(a5.done, false);
    b1.value!(); // queda un hueco libre, pero a ya tiene una y b y c siguen activas
    await tick();
    assert.equal(a5.done, false);
    a4.value!();
    const a5got = await a5.p;
    assert.ok(a5got);
    a5got();
    c1.value!();
  });

  test("tiempo de espera agotado: devuelve null, sale de la cola y no se queda con el hueco", async () => {
    noteUserActivity("b");
    const a1 = await acquireUploadSlot("a", 20);
    assert.ok(a1);
    assert.equal(await acquireUploadSlot("a", 30), null);
    a1();
    // La que se rindió no recibe el hueco liberado: siguen libres los 3 (b sigue activa, una por persona).
    const again = await Promise.all([acquireUploadSlot("a", 20), acquireUploadSlot("b", 20), acquireUploadSlot("c", 20)]);
    assert.ok(again.every(Boolean));
    for (const r of again) r!();
  });

  test("si el cliente se va mientras espera (señal abortada), sale de la cola en el acto y no recibe el hueco", async () => {
    const held = await Promise.all(Array.from({ length: MAX_UPLOADS_AT_ONCE }, () => acquireUploadSlot("a", 20)));
    assert.ok(held.every(Boolean));
    const ac = new AbortController();
    const gone = track(acquireUploadSlot("a", 60_000, { signal: ac.signal }));
    await tick();
    assert.equal(gone.done, false);
    const started = Date.now();
    ac.abort();
    assert.equal(await gone.p, null);
    assert.ok(Date.now() - started < 1000, "no espera los 60 s");
    // Ya abortada: ni entra en la cola.
    assert.equal(await acquireUploadSlot("a", 60_000, { signal: ac.signal }), null);
    // El hueco liberado es para la siguiente que espera, no para la que se fue.
    const next = track(acquireUploadSlot("a", 1000));
    held[0]!();
    const got = await next.p;
    assert.ok(got);
    got();
    for (const r of held.slice(1)) r!();
    const free = await Promise.all(Array.from({ length: MAX_UPLOADS_AT_ONCE }, () => acquireUploadSlot("a", 20)));
    assert.ok(free.every(Boolean), "no queda ningún hueco ocupado por la que se fue");
    for (const r of free) r!();
  });

  test("la actividad caduca a los 5 minutos: alguien que dejó de usar la app no limita a quien sube", async () => {
    noteUserActivity("viejo", Date.now() - ACTIVE_WINDOW_MS - 1);
    assert.equal(ACTIVE_WINDOW_MS, 5 * 60_000);
    const held = await Promise.all(Array.from({ length: 3 }, () => acquireUploadSlot("a", 20)));
    assert.ok(held.every(Boolean)); // «viejo» ya no cuenta
    for (const r of held) r!();
    assert.equal(recentlyActiveUsers().has("viejo"), false);
  });

  test("si caduca la otra persona mientras se espera, la cola avanza sola", async () => {
    noteUserActivity("b", Date.now() - ACTIVE_WINDOW_MS + 150); // le quedan ~150 ms de actividad
    const a1 = await acquireUploadSlot("a", 20);
    assert.ok(a1);
    const a2 = track(acquireUploadSlot("a", 10_000));
    await tick();
    assert.equal(a2.done, false); // b aún cuenta: una por persona
    const got = await a2.p; // al caducar b, a vuelve a estar sola y recibe el segundo hueco sin liberar el primero
    assert.ok(got);
    got();
    a1();
  });

  test("quien tiene una subida en curso cuenta como activa aunque haga más de 5 minutos que la empezó", async () => {
    const b1 = await acquireUploadSlot("b", 20);
    assert.ok(b1);
    forgetUserActivity(); // como si la actividad de b ya hubiera caducado
    const a1 = await acquireUploadSlot("a", 20);
    assert.ok(a1);
    assert.equal(await acquireUploadSlot("a", 20), null);
    b1();
    a1();
  });
});

describe("declaredLength", () => {
  test("solo acepta un entero válido", () => {
    assert.equal(declaredLength(new Headers()), null);
    assert.equal(declaredLength(new Headers({ "content-length": "abc" })), null);
    assert.equal(declaredLength(new Headers({ "content-length": "-5" })), null);
    assert.equal(declaredLength(new Headers({ "content-length": "1234" })), 1234);
    assert.equal(declaredLength(new Headers({ "content-length": "0" })), 0);
  });
});

describe("readBodyLimited: subidas lentas", () => {
  const enc = new TextEncoder();
  const dripReq = (chunks: number, everyMs: number) => {
    let sent = 0;
    const body = new ReadableStream<Uint8Array>({
      async pull(c) {
        if (sent >= chunks) return c.close();
        await new Promise((r) => setTimeout(r, everyMs));
        sent++;
        c.enqueue(enc.encode("x"));
      },
    });
    return new Request("http://localhost/x", { method: "POST", body, duplex: "half", headers: { "content-type": "multipart/form-data; boundary=zz" } } as RequestInit);
  };

  test("una subida que va a pocos bytes por segundo se corta y libera el hueco", async () => {
    resetUploadSlots();
    const release = await acquireUploadSlot("u1");
    assert.ok(release);
    const t0 = Date.now();
    try {
      await assert.rejects(
        readBodyLimited(dripReq(1000, 20), 10_000_000, "formData", { windowMs: 100, minBytesPerSec: 1000 }),
        UploadTooSlowError,
      );
    } finally {
      release();
    }
    assert.ok(Date.now() - t0 < 2000);
    const again = await Promise.all(Array.from({ length: MAX_UPLOADS_AT_ONCE }, () => acquireUploadSlot("u1", 20)));
    assert.ok(again.every(Boolean));
    for (const r of again) r!();
  });

  test("el tiempo máximo total también corta", async () => {
    await assert.rejects(readBodyLimited(dripReq(1000, 20), 10_000_000, "text", { windowMs: 60_000, totalMs: 150 }), UploadTooSlowError);
  });

  test("una subida normal pasa", async () => {
    const fd = new FormData();
    fd.append("file", new File([new Uint8Array(500_000)], "a.bin"));
    const req = new Request("http://localhost/x", { method: "POST", body: fd });
    const out = await readBodyLimited(req, 10_000_000, "formData", { windowMs: 100, minBytesPerSec: 1000 });
    assert.equal((out.get("file") as File).size, 500_000);
  });
});

describe("uploadTotalMs", () => {
  const MB = 1024 * 1024;
  test("los adjuntos siguen con 3 min de margen y tope de 30 min", () => {
    assert.equal(uploadTotalMs(0), 3 * 60_000);
    assert.equal(uploadTotalMs(10 * MB), 3 * 60_000 + ((10 * MB) / (20 * 1024)) * 1000);
    assert.equal(uploadTotalMs(500 * MB), UPLOAD_MAX_TOTAL_MS);
  });
  test("la importación de un proyecto de 500 MB a ~190 KB/s cabe en su tope (3 h), no en los 30 min de los adjuntos", () => {
    const needed = ((500 * MB) / (190 * 1024)) * 1000; // ~45 min
    assert.ok(needed > UPLOAD_MAX_TOTAL_MS);
    const total = uploadTotalMs(500 * MB, IMPORT_MAX_TOTAL_MS);
    assert.equal(total, IMPORT_MAX_TOTAL_MS);
    assert.ok(total > needed * 3);
    // Un archivo pequeño no gana tiempo extra por ser una importación.
    assert.equal(uploadTotalMs(MB, IMPORT_MAX_TOTAL_MS), uploadTotalMs(MB));
  });
});
