// Memoria en proceso con caducidad (lib/memo.ts): la usan el layout y las páginas de administración.
import assert from "node:assert/strict";
import { test } from "node:test";
import { HEALTH_CACHE_MS } from "../src/lib/health";
import { boundedMemo, clearBoundedMemo, invalidateMemo, memo, MEMO_TTL_MS } from "../src/lib/memo";

test("memo: guarda durante la caducidad, comparte la consulta en curso y vuelve a consultar al caducar", async () => {
  let calls = 0;
  const fn = async () => ++calls;
  const t0 = 1_000_000;
  const [a, b] = await Promise.all([memo("t:a", fn, MEMO_TTL_MS, t0), memo("t:a", fn, MEMO_TTL_MS, t0)]);
  assert.deepEqual([a, b, calls], [1, 1, 1]);
  assert.equal(await memo("t:a", fn, MEMO_TTL_MS, t0 + MEMO_TTL_MS - 1), 1);
  assert.equal(await memo("t:a", fn, MEMO_TTL_MS, t0 + MEMO_TTL_MS), 2);
  // Reloj hacia atrás: no se fía de lo guardado.
  assert.equal(await memo("t:a", fn, MEMO_TTL_MS, t0), 3);
  invalidateMemo("t:a");
});

test("memo: un error no se guarda", async () => {
  let calls = 0;
  await assert.rejects(memo("t:err", async () => { calls++; throw new Error("caída"); }));
  assert.equal(await memo("t:err", async () => ++calls), 2);
  invalidateMemo("t:err");
});

test("invalidateMemo: una clave o todas las que empiezan por un prefijo acabado en «:»", async () => {
  let n = 0;
  const fn = async () => ++n;
  await memo("g:uno", fn);
  await memo("g:dos", fn);
  await memo("otra", fn);
  invalidateMemo("g:uno");
  assert.equal(await memo("g:uno", fn), 4);
  assert.equal(await memo("g:dos", fn), 2);
  invalidateMemo("g:");
  assert.equal(await memo("g:dos", fn), 5);
  assert.equal(await memo("g:uno", fn), 6);
  assert.equal(await memo("otra", fn), 3);
  // Una consulta en marcha al invalidar no se queda guardada.
  let release!: (v: number) => void;
  const slow = memo("g:lenta", () => new Promise<number>((r) => (release = r)));
  invalidateMemo("g:");
  release(100);
  assert.equal(await slow, 100);
  assert.equal(await memo("g:lenta", async () => 200), 200);
  invalidateMemo("g:");
  invalidateMemo("otra");
});

test("boundedMemo: caduca, comparte la consulta en curso, no guarda errores y no pasa del tope (sale la menos usada)", async () => {
  const m = boundedMemo("test:acotada", 1000, 3);
  m.clear();
  let calls = 0;
  const fn = async () => ++calls;
  const t0 = 5_000_000;
  const [a, b] = await Promise.all([m.get("a", fn, t0), m.get("a", fn, t0)]);
  assert.deepEqual([a, b, calls], [1, 1, 1]);
  assert.equal(await m.get("a", fn, t0 + 999), 1);
  assert.equal(await m.get("a", fn, t0 + 1000), 2, "caducado");
  await assert.rejects(m.get("err", async () => Promise.reject(new Error("x")), t0));
  assert.equal(await m.get("err", async () => 7, t0), 7, "un error no se guarda");
  // Tope de 3: a, err y b; usar «a» la pone al día, así que al entrar «c» sale «err».
  await m.get("b", fn, t0 + 1000);
  await m.get("a", fn, t0 + 1001);
  await m.get("c", fn, t0 + 1001);
  assert.equal(m.size, 3);
  assert.equal(await m.get("err", async () => 8, t0 + 1001), 8, "olvidada por el tope");
  // La misma memoria por nombre, aunque se cree dos veces (rutas empaquetadas por separado).
  assert.equal(boundedMemo("test:acotada", 1000, 3).size, 3);
  m.clear();
  assert.equal(m.size, 0);
});

test("boundedMemo: lo caducado sale al leer (sin esperar al tope), y clearBoundedMemo la vacía por nombre", async () => {
  const m = boundedMemo("test:barrido", 1000, 100);
  m.clear();
  const t0 = 7_000_000;
  for (let i = 0; i < 50; i++) await m.get(`k${i}`, async () => i, t0);
  assert.equal(m.size, 50);
  // Antes de caducar no se barre nada.
  await m.get("otra", async () => -1, t0 + 999);
  assert.equal(m.size, 51);
  // Pasado el plazo, la primera lectura (de cualquier clave) se lleva todas las caducadas.
  assert.equal(await m.get("otra", async () => -2, t0 + 1500), -1, "la de t0+999 sigue viva");
  assert.equal(m.size, 1);
  clearBoundedMemo("test:barrido");
  assert.equal(m.size, 0);
  clearBoundedMemo("test:no-existe");
});

test("boundedMemo: tope de bytes con sizeOf (salen las menos usadas; una que sola no cabe no se guarda)", async () => {
  const m = boundedMemo("test:bytes", 60_000, 100, { maxBytes: 10, sizeOf: (v) => (v as Buffer).byteLength });
  m.clear();
  const t0 = 9_000_000;
  const buf = (n: number) => async () => Buffer.alloc(n);
  await m.get("a", buf(4), t0);
  await m.get("b", buf(4), t0);
  assert.equal(m.bytes, 8);
  await m.get("a", buf(4), t0); // «a» pasa a ser la más reciente
  await m.get("c", buf(4), t0);
  await Promise.resolve();
  assert.equal(m.size, 2, "sale «b», la menos usada");
  assert.equal(m.bytes, 8);
  let calls = 0;
  await m.get("b", async () => (calls++, Buffer.alloc(4)), t0);
  assert.equal(calls, 1, "«b» se había olvidado");
  await m.get("grande", buf(11), t0);
  await Promise.resolve();
  assert.equal(m.size, 0, "11 bytes no caben en 10: no se guarda (y se lleva las demás)");
  assert.equal(m.bytes, 0);
  await m.get("x", buf(3), t0);
  m.delete("x");
  assert.equal(m.bytes, 0, "delete descuenta sus bytes");
  m.clear();
});

test("/api/health guarda su resultado entre 2 y 5 s", () => {
  assert.ok(HEALTH_CACHE_MS >= 2000 && HEALTH_CACHE_MS <= 5000);
});
