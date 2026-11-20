import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { createGate, createUploadCapTracker, parseUploadCap, planUploads, QueueStopped, retryDelayMs, runQueue, summarizeSkipped, UPLOAD_PER_USER_HEADER, withRetry } from "../src/lib/upload-queue";

const file = (name: string, size: number) => ({ name, size }) as File;

describe("planUploads", () => {
  test("acepta más de 10 archivos y omite los que no caben con su motivo", () => {
    const files = Array.from({ length: 35 }, (_, i) => file(`f${i}.zip`, 1000));
    files.push(file("grande.zip", 50_000), file("vacio.txt", 0));
    const { accepted, skipped } = planUploads(files, { fileMaxBytes: 10_000, remainingBytes: 30_000 });
    assert.equal(accepted.length, 30);
    assert.deepEqual(skipped.filter((s) => s.reason === "too_big").map((s) => s.name), ["grande.zip"]);
    assert.deepEqual(skipped.filter((s) => s.reason === "empty").map((s) => s.name), ["vacio.txt"]);
    assert.equal(skipped.filter((s) => s.reason === "total").length, 5);
  });
  test("un archivo que no cabe en la suma no impide que entren los pequeños siguientes", () => {
    const { accepted, skipped } = planUploads([file("a", 600), file("b", 600), file("c", 300)], { fileMaxBytes: 1000, remainingBytes: 1000 });
    assert.deepEqual(accepted.map((f) => f.name), ["a", "c"]);
    assert.deepEqual(skipped.map((s) => s.name), ["b"]);
  });
});

describe("runQueue", () => {
  test("nunca supera la concurrencia y conserva el orden de resultados", async () => {
    let active = 0;
    let peak = 0;
    const items = Array.from({ length: 12 }, (_, i) => i);
    const res = await runQueue(items, async (n) => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 5 + (n % 3)));
      active--;
      return n * 2;
    }, { concurrency: 3 });
    assert.equal(peak, 3);
    assert.deepEqual(res.map((r) => (r.status === "fulfilled" ? r.value : -1)), items.map((n) => n * 2));
  });
  test("un fallo no detiene al resto y notifica el progreso", async () => {
    const settled: number[] = [];
    const res = await runQueue([1, 2, 3, 4], async (n) => {
      if (n === 2) throw new Error("x");
      return n;
    }, { concurrency: 2, onSettle: (i) => settled.push(i) });
    assert.deepEqual(res.map((r) => r.status), ["fulfilled", "rejected", "fulfilled", "fulfilled"]);
    assert.equal(settled.length, 4);
  });
  test("stopWhen deja sin empezar los elementos que faltan", async () => {
    const res = await runQueue([1, 2, 3, 4, 5], async (n) => {
      if (n === 1) throw new Error("total");
      return n;
    }, { concurrency: 1, stopWhen: () => true });
    assert.ok(res.slice(1).every((r) => r.status === "rejected" && r.reason instanceof QueueStopped));
  });
  test("lista vacía", async () => {
    assert.deepEqual(await runQueue([], async () => 1), []);
  });
});

describe("withRetry", () => {
  const waits: number[] = [];
  const sleep = async (ms: number) => void waits.push(ms);
  test("reintenta 429/503 con espera creciente y acaba bien", async () => {
    waits.length = 0;
    let calls = 0;
    const out = await withRetry(async () => {
      if (++calls < 3) throw Object.assign(new Error("busy"), { status: calls === 1 ? 429 : 503 });
      return "ok";
    }, { sleep });
    assert.equal(out, "ok");
    assert.deepEqual(waits, [2000, 4000]);
  });
  test("respeta Retry-After y se rinde tras los reintentos", async () => {
    waits.length = 0;
    let calls = 0;
    await assert.rejects(withRetry(async () => {
      calls++;
      throw Object.assign(new Error("busy"), { status: 429, retryAfterSec: 5 });
    }, { sleep, retries: 2 }));
    assert.equal(calls, 3);
    assert.deepEqual(waits, [5000, 5000]);
  });
  test("no reintenta otros errores", async () => {
    let calls = 0;
    await assert.rejects(withRetry(async () => {
      calls++;
      throw Object.assign(new Error("grande"), { status: 413 });
    }, { sleep }));
    assert.equal(calls, 1);
  });
  test("retryDelayMs tiene tope", () => {
    assert.equal(retryDelayMs(10), 30_000);
    assert.equal(retryDelayMs(0, 60), 60_000);
    assert.equal(retryDelayMs(0, 600), 65_000);
  });
  test("espera total acotada y sin reintentos si se aborta", async () => {
    const slept: number[] = [];
    const sleep = async (ms: number) => void slept.push(ms);
    const err = Object.assign(new Error("x"), { status: 429, retryAfterSec: 60 });
    let calls = 0;
    await assert.rejects(withRetry(async () => { calls++; throw err; }, { sleep }));
    assert.deepEqual(slept, [60_000]); // el segundo (120 s en total) ya excede los 70 s
    assert.equal(calls, 2);
    const ac = new AbortController();
    ac.abort();
    calls = 0;
    // Ya abortada: ni el primer intento.
    await assert.rejects(withRetry(async () => { calls++; throw err; }, { sleep, signal: ac.signal }), QueueStopped);
    assert.equal(calls, 0);
  });
  // Antes la espera (hasta 65 s con Retry-After) seguía aunque se pulsara «Descartar cambios» y después se enviaba igual.
  test("abortar durante la espera la corta y no vuelve a intentarlo", async () => {
    const err = Object.assign(new Error("ocupado"), { status: 429, retryAfterSec: 60 });
    const ac = new AbortController();
    let calls = 0;
    const started = Date.now();
    const run = withRetry(async () => {
      calls++;
      if (calls === 1) setTimeout(() => ac.abort(), 20);
      throw err;
    }, { signal: ac.signal });
    await assert.rejects(run, QueueStopped);
    assert.equal(calls, 1);
    assert.ok(Date.now() - started < 5_000, "la espera de 60 s se corta");
  });
  test("runQueue con señal abortada deja el resto sin empezar", async () => {
    const ac = new AbortController();
    const out = await runQueue([1, 2, 3, 4], async (n) => { if (n === 1) ac.abort(); return n; }, { concurrency: 1, signal: ac.signal });
    assert.equal(out[0]!.status, "fulfilled");
    assert.ok(out.slice(1).every((r) => r.status === "rejected" && r.reason instanceof QueueStopped));
  });
});

test("summarizeSkipped acorta la lista", () => {
  const s = Array.from({ length: 8 }, (_, i) => ({ name: `f${i}`, size: 1, reason: "total" as const }));
  assert.equal(summarizeSkipped(s, (x) => x.name, 3), "f0, f1, f2 … +5");
});

describe("tope por persona que indica el servidor", () => {
  const tick = () => new Promise((r) => setImmediate(r));
  /** Promesas que se resuelven a mano, para ver cuántas van a la vez sin pausas. */
  const deferred = () => {
    let resolve!: () => void;
    const p = new Promise<void>((r) => { resolve = r; });
    return { p, resolve };
  };

  test("parseUploadCap: entero entre 1 y 3; lo demás no vale", () => {
    assert.equal(UPLOAD_PER_USER_HEADER, "X-Pizarro-Upload-Per-User");
    assert.equal(parseUploadCap("1"), 1);
    assert.equal(parseUploadCap(" 3 "), 3);
    assert.equal(parseUploadCap("7"), 3);
    for (const bad of [null, undefined, "", "0", "-1", "1.5", "dos"]) assert.equal(parseUploadCap(bad), null, String(bad));
  });

  test("runQueue con limit: baja a 1 a mitad de la cola (sin cortar las que ya van) y vuelve a 3", async () => {
    let cap = 3;
    let active = 0;
    const peaks: number[] = [];
    const gates = Array.from({ length: 9 }, deferred);
    const run = runQueue(gates, async (g, i) => {
      active++;
      peaks[i] = active;
      await g.p;
      active--;
      // La primera respuesta dice «1»; la sexta, «3».
      if (i === 0) cap = 1;
      if (i === 5) cap = 3;
    }, { limit: () => cap });
    await tick();
    assert.equal(active, 3); // empiezan 3 (aún no se sabe nada)
    gates[0]!.resolve();
    await tick();
    assert.equal(active, 2); // con tope 1 no empieza ninguna más hasta que queden menos de 1 en marcha
    gates[1]!.resolve();
    gates[2]!.resolve();
    await tick();
    assert.equal(active, 1); // ahora de una en una
    gates[3]!.resolve();
    await tick();
    assert.equal(active, 1);
    gates[4]!.resolve();
    await tick();
    assert.equal(active, 1);
    gates[5]!.resolve(); // dice «3» al terminar: se empiezan las que quedan hasta 3
    await tick();
    assert.equal(active, 3);
    for (const g of gates.slice(6)) g.resolve();
    const res = await run;
    assert.ok(res.every((r) => r.status === "fulfilled"));
    assert.deepEqual(peaks.slice(3, 6), [1, 1, 1]);
  });

  test("runQueue: un limit de 0 o NaN cuenta como 1 y uno mayor que concurrency no lo supera", async () => {
    for (const [limit, expected] of [[0, 1], [Number.NaN, 1], [10, 2]] as const) {
      let active = 0;
      let peak = 0;
      await runQueue([1, 2, 3, 4, 5], async () => {
        active++;
        peak = Math.max(peak, active);
        await tick();
        active--;
      }, { concurrency: 2, limit: () => limit });
      assert.equal(peak, expected, String(limit));
    }
  });

  test("createGate: los reintentos de subidas ya empezadas también van de uno en uno con tope 1", async () => {
    let cap = 3;
    const gate = createGate(() => cap);
    let inside = 0;
    let peak = 0;
    const gates = Array.from({ length: 3 }, deferred);
    const runs = gates.map((g) => gate.run(async () => {
      inside++;
      peak = Math.max(peak, inside);
      await g.p;
      inside--;
    }));
    await tick();
    assert.equal(inside, 3);
    cap = 1; // el servidor dice 1: las tres siguen hasta terminar
    for (const g of gates) g.resolve();
    await Promise.all(runs);
    // Ahora tres reintentos a la vez: entran de uno en uno.
    peak = 0;
    const retries = Array.from({ length: 3 }, deferred);
    const again = retries.map((g) => gate.run(async () => {
      inside++;
      peak = Math.max(peak, inside);
      await g.p;
      inside--;
    }));
    await tick();
    assert.equal(inside, 1);
    for (const g of retries) { g.resolve(); await tick(); }
    await Promise.all(again);
    assert.equal(peak, 1);
    // Un fallo dentro libera el paso.
    await assert.rejects(gate.run(async () => { throw new Error("x"); }));
    assert.equal(await gate.run(async () => 5), 5);
  });

  test("createUploadCapTracker: toma la cabecera de cualquier respuesta; antes de una tanda pregunta solo si lo sabido es viejo", async () => {
    let now = 1_000_000;
    let asked = 0;
    let answer: number | null = 1;
    const cap = createUploadCapTracker({ now: () => now, freshMs: 15_000, fetchCap: async () => { asked++; if (answer === null) throw new Error("sin red"); return answer; } });
    assert.equal(cap.current(), 3); // sin saber nada, lo de siempre
    assert.equal(await cap.refresh(), 1);
    assert.equal(asked, 1);
    now += 5_000;
    assert.equal(await cap.refresh(), 1); // reciente: no vuelve a preguntar
    assert.equal(asked, 1);
    cap.note(new Headers({ [UPLOAD_PER_USER_HEADER]: "3" })); // respuesta 2xx con «3»
    assert.equal(cap.current(), 3);
    cap.note(new Headers()); // sin cabecera (otro servidor, proxy): no cambia
    cap.note(null);
    assert.equal(cap.current(), 3);
    now += 20_000;
    answer = null; // la pregunta falla: se queda con lo que sabía
    assert.equal(await cap.refresh(), 3);
    assert.equal(asked, 2);
  });
});

describe("subidas y «Descartar cambios»", () => {
  test("createGate: con la señal abortada no se ejecuta lo que esperaba turno ni lo nuevo", async () => {
    const gate = createGate(() => 1);
    let release!: () => void;
    const busy = gate.run(() => new Promise<void>((r) => (release = r)));
    const ac = new AbortController();
    let ran = 0;
    const waiting = gate.run(async () => void ran++, ac.signal);
    ac.abort();
    await assert.rejects(waiting, QueueStopped);
    await assert.rejects(gate.run(async () => void ran++, ac.signal), QueueStopped);
    release();
    await busy;
    assert.equal(ran, 0);
    // El paso sigue libre para los demás.
    assert.equal(await gate.run(async () => 7), 7);
  });

  // Como uploadFile (components/board/upload.ts, que no se puede importar aquí: usa hooks de React y las pruebas corren
  // con la condición react-server): withRetry → puerta → fetch, con la señal de la tanda en las dos.
  test("tras abortar en la espera de un 429 no hay más fetch", async () => {
    const realFetch = globalThis.fetch;
    const ac = new AbortController();
    const urls: string[] = [];
    globalThis.fetch = (async (input: string | URL) => {
      urls.push(String(input));
      setTimeout(() => ac.abort(), 20);
      return new Response(JSON.stringify({ error: "ocupado" }), { status: 429, headers: { "Retry-After": "30" } });
    }) as typeof fetch;
    try {
      const gate = createGate(() => 3);
      const send = withRetry(() => gate.run(async () => {
        const res = await fetch("/api/tasks/tarea1/attachments", { method: "POST" });
        throw Object.assign(new Error("ocupado"), { status: res.status, retryAfterSec: Number(res.headers.get("Retry-After")) });
      }, ac.signal), { signal: ac.signal });
      await assert.rejects(send, QueueStopped);
      await new Promise((r) => setTimeout(r, 50));
      assert.deepEqual(urls, ["/api/tasks/tarea1/attachments"], "un solo envío: el reintento no sale");
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});
