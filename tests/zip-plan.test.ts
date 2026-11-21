import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { partSuffix, planPackages, type PlanItem } from "../src/lib/zip-plan";
import { zipPlanToken } from "../src/lib/zip-token";
import { acquireZipSlot, sizedZipEntries, zipBodyStream, zipRequestMode, zipVersionConflict } from "../src/lib/release-zip";

const items = (...sizes: number[]): PlanItem[] => sizes.map((size, index) => ({ index, size }));

describe("planPackages", () => {
  test("sin ficheros no hay paquetes", () => assert.deepEqual(planPackages([], 100), []));

  test("si todo cabe, un solo paquete con el orden original", () => {
    const p = planPackages(items(30, 10, 50), 100);
    assert.equal(p.length, 1);
    assert.deepEqual(p[0], { items: [0, 1, 2], bytes: 90, oversize: false });
  });

  test("encaja en el mínimo práctico de paquetes y respeta el tope", () => {
    const p = planPackages(items(60, 50, 50, 40, 30, 30), 100);
    assert.equal(p.length, 3);
    for (const pk of p) assert.ok(pk.bytes <= 100);
    assert.equal(p.reduce((n, pk) => n + pk.bytes, 0), 260);
    // Cada fichero aparece exactamente una vez.
    assert.deepEqual(p.flatMap((x) => x.items).sort((a, b) => a - b), [0, 1, 2, 3, 4, 5]);
  });

  test("un fichero mayor que el tope va solo y marcado", () => {
    const p = planPackages(items(20, 250, 30), 100);
    assert.equal(p.length, 2);
    const big = p.find((x) => x.oversize)!;
    assert.deepEqual(big.items, [1]);
    const rest = p.find((x) => !x.oversize)!;
    assert.deepEqual(rest.items, [0, 2]);
  });

  test("un fichero igual al tope cabe sin marcarse", () => {
    const p = planPackages(items(100, 1), 100);
    assert.equal(p.length, 2);
    assert.ok(p.every((x) => !x.oversize));
  });

  test("los archivos de una misma tarea pueden quedar en paquetes distintos", () => {
    // Tarea A: 3 archivos de 40 (120 en total, más que el paquete de 100); tarea B: 1 de 50.
    const owner = ["A", "A", "A", "B"];
    const p = planPackages(items(40, 40, 40, 50), 100);
    for (const pk of p) assert.ok(pk.bytes <= 100 && !pk.oversize);
    const packagesOfA = p.filter((pk) => pk.items.some((i) => owner[i] === "A"));
    assert.equal(packagesOfA.length, 2);
    // Ninguno se pierde ni se repite.
    assert.deepEqual(p.flatMap((x) => x.items).sort((a, b) => a - b), [0, 1, 2, 3]);
  });

  test("es determinista con tamaños iguales", () => {
    const a = planPackages(items(40, 40, 40, 40, 40), 100);
    const b = planPackages(items(40, 40, 40, 40, 40), 100);
    assert.deepEqual(a, b);
    assert.equal(a.length, 3);
  });
});

test("partSuffix", () => {
  assert.equal(partSuffix(1, 1), "");
  assert.equal(partSuffix(2, 3), "-2de3");
});

describe("zipPlanToken", () => {
  const files = [{ id: "a1", size: 10 }, { id: "b2", size: 20 }];

  test("es estable y de 16 hex", () => {
    assert.equal(zipPlanToken(files, 25), zipPlanToken([...files], 25));
    assert.match(zipPlanToken(files, 25), /^[0-9a-f]{16}$/);
  });

  test("cambia con el id, el tamaño, el orden o el tope", () => {
    const base = zipPlanToken(files, 25);
    assert.notEqual(zipPlanToken([{ id: "a1", size: 10 }, { id: "c3", size: 20 }], 25), base);
    assert.notEqual(zipPlanToken([{ id: "a1", size: 11 }, { id: "b2", size: 20 }], 25), base);
    assert.notEqual(zipPlanToken([files[1]!, files[0]!], 25), base);
    assert.notEqual(zipPlanToken(files, 50), base);
    assert.notEqual(zipPlanToken(files.slice(0, 1), 25), base);
  });

  test("no confunde fronteras entre ficheros", () => {
    assert.notEqual(zipPlanToken([{ id: "a", size: 12 }], 5), zipPlanToken([{ id: "a1", size: 2 }], 5));
  });
});

describe("zipRequestMode y conflicto de versión", () => {
  const entries = [{ id: "a1", name: "x", size: 10, open: async function* () {} }];
  const v = zipPlanToken(entries, 25);
  const part = (q: string) => {
    const mode = zipRequestMode(`http://x/api?${q}`);
    assert.equal(mode?.kind, "part", q);
    return mode as Extract<typeof mode, { kind: "part" }>;
  };

  test("lee ?part= y ?v=; sin alguno de los dos, «incomplete» (ya no hay paquete sin número ni sin token)", () => {
    assert.deepEqual(part(`part=2&v=${v}`), { kind: "part", part: 2, version: v });
    assert.deepEqual(zipRequestMode("http://x/api?plan=1"), { kind: "plan" });
    for (const q of ["", "part=2", `v=${v}`, "plan=0"]) assert.deepEqual(zipRequestMode(`http://x/api?${q}`), { kind: "incomplete" }, q);
    for (const q of ["part=1&v=zz", `part=0&v=${v}`, `part=x&v=${v}`, `part=1001&v=${v}`]) assert.equal(zipRequestMode(`http://x/api?${q}`), null, q);
  });

  test("con token igual no hay conflicto; distinto, 409", async () => {
    assert.equal(zipVersionConflict(part(`part=1&v=${v}`), entries, 25, "m"), null);
    assert.equal(zipVersionConflict({ kind: "plan" }, entries, 25, "m"), null);
    const changed = [...entries, { id: "b2", name: "y", size: 5, open: async function* () {} }];
    const res = zipVersionConflict(part(`part=1&v=${v}`), changed, 25, "Cambiaron");
    assert.equal(res?.status, 409);
    assert.equal(await res?.text(), "Cambiaron");
  });
});

describe("zipBodyStream: el hueco del ZIP se suelta al terminar de enviarlo", () => {
  const zip = Buffer.alloc(2.5 * 1024 * 1024, 7);
  const held = (user: string) => {
    const again = acquireZipSlot(user);
    again?.();
    return again === null;
  };

  test("a trozos de 1 MB; el hueco sigue ocupado hasta el último", async () => {
    const release = acquireZipSlot("zs-1")!;
    const reader = zipBodyStream(zip, release).getReader();
    assert.equal(held("zs-1"), true, "recién creada, aún sin enviar");
    const sizes: number[] = [];
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      sizes.push(value.length);
      if (sizes.length < 3) assert.equal(held("zs-1"), true, `tras el trozo ${sizes.length}`);
    }
    assert.deepEqual(sizes, [1024 * 1024, 1024 * 1024, 0.5 * 1024 * 1024]);
    assert.equal(held("zs-1"), false, "enviado entero: hueco libre");
  });

  test("también se suelta si se cancela la descarga o se aborta la petición", async () => {
    const release = acquireZipSlot("zs-2")!;
    const reader = zipBodyStream(zip, release).getReader();
    await reader.read();
    assert.equal(held("zs-2"), true);
    await reader.cancel();
    assert.equal(held("zs-2"), false);

    const ac = new AbortController();
    const release2 = acquireZipSlot("zs-3")!;
    const body = new Response(zipBodyStream(zip, release2, { signal: ac.signal }));
    assert.equal(held("zs-3"), true);
    ac.abort();
    assert.equal(held("zs-3"), false);
    await body.body?.cancel();
  });

  test("un cliente que deja de leer: a los idleMs sin pedir nada se corta la respuesta y se suelta el hueco", async () => {
    const release = acquireZipSlot("zs-5")!;
    const reader = zipBodyStream(zip, release, { idleMs: 80 }).getReader();
    // Leyendo a buen ritmo (más deprisa que idleMs entre trozos) no se corta.
    await reader.read();
    await new Promise((r) => setTimeout(r, 40));
    await reader.read();
    assert.equal(held("zs-5"), true, "sigue leyendo: hueco ocupado");
    // Deja de leer: pasado idleMs, hueco libre y el siguiente read falla (la descarga se corta).
    await new Promise((r) => setTimeout(r, 200));
    assert.equal(held("zs-5"), false, "sin leer: hueco libre");
    await assert.rejects(reader.read(), /no lee/);

    // Con un flujo de trozos (como el ZIP de verdad): un trozo lento de leer del disco no cuenta como cliente parado.
    const release2 = acquireZipSlot("zs-6")!;
    async function* slow() {
      yield new Uint8Array(10);
      await new Promise((r) => setTimeout(r, 200));
      yield new Uint8Array(10);
    }
    const got = Buffer.from(await new Response(zipBodyStream(slow(), release2, { idleMs: 80 })).arrayBuffer());
    assert.equal(got.length, 20);
    assert.equal(held("zs-6"), false);
  });

  test("como cuerpo de Response, llega entero", async () => {
    const release = acquireZipSlot("zs-4")!;
    const got = Buffer.from(await new Response(zipBodyStream(zip, release)).arrayBuffer());
    assert.ok(got.equals(zip));
    assert.equal(held("zs-4"), false);
  });
});

describe("zipBodyStream: cómo acabó el envío (el vale solo da por terminado el paquete enviado entero)", () => {
  const zip = Buffer.alloc(2.5 * 1024 * 1024, 7);
  const outcomeOf = (user: string) => {
    const slot = acquireZipSlot(user)!;
    const seen: string[] = [];
    return { release: (o: string) => { seen.push(o); slot(); }, seen };
  };

  test("entero: ok (una sola vez)", async () => {
    const r = outcomeOf("zo-1");
    await new Response(zipBodyStream(zip, r.release)).arrayBuffer();
    assert.deepEqual(r.seen, ["ok"]);
    async function* parts() {
      yield new Uint8Array(3);
      yield new Uint8Array(4);
    }
    const r2 = outcomeOf("zo-1b");
    await new Response(zipBodyStream(parts(), r2.release)).arrayBuffer();
    assert.deepEqual(r2.seen, ["ok"]);
  });

  test("cancelada o abortada a medias: aborted", async () => {
    const r = outcomeOf("zo-2");
    const reader = zipBodyStream(zip, r.release).getReader();
    await reader.read();
    await reader.cancel();
    assert.deepEqual(r.seen, ["aborted"]);
    const ac = new AbortController();
    const r2 = outcomeOf("zo-3");
    const body = zipBodyStream(zip, r2.release, { signal: ac.signal });
    ac.abort();
    assert.deepEqual(r2.seen, ["aborted"]);
    await body.cancel();
    assert.deepEqual(r2.seen, ["aborted"], "una sola vez");
  });

  test("un fichero que falla a medias (ha cambiado) o un cliente que no lee: error", async () => {
    async function* broken() {
      yield new Uint8Array(5);
      throw new Error("El fichero ha cambiado");
    }
    const r = outcomeOf("zo-4");
    await assert.rejects(new Response(zipBodyStream(broken(), r.release)).arrayBuffer());
    assert.deepEqual(r.seen, ["error"]);
    const r2 = outcomeOf("zo-5");
    const reader = zipBodyStream(zip, r2.release, { idleMs: 50 }).getReader();
    await reader.read();
    await new Promise((res) => setTimeout(res, 150));
    assert.deepEqual(r2.seen, ["error"]);
    await reader.read().catch(() => {});
  });
});

describe("sizedZipEntries", () => {
  test("consulta los tamaños en paralelo (como mucho 16 a la vez), conserva el orden y omite los ausentes", async () => {
    const candidates = Array.from({ length: 50 }, (_, i) => ({ id: `a${i}`, name: `f${i}.txt`, open: async function* () {} }));
    let active = 0;
    let peak = 0;
    const entries = await sizedZipEntries(candidates, async (c) => {
      active++;
      peak = Math.max(peak, active);
      const n = Number(c.id.slice(1));
      // Terminan en otro orden que el de salida.
      await new Promise((r) => setTimeout(r, (50 - n) % 7));
      active--;
      return n % 10 === 3 ? null : n * 10;
    });
    assert.equal(peak, 16);
    assert.deepEqual(entries.map((e) => [e.id, e.name, e.size]), candidates.filter((_, i) => i % 10 !== 3).map((c) => [c.id, c.name, Number(c.id.slice(1)) * 10]));
  });
});
