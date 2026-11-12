// Memoria en proceso con caducidad (lib/memo.ts): la usan el layout y las páginas de administración.
import assert from "node:assert/strict";
import { test } from "node:test";
import { invalidateMemo, memo, MEMO_TTL_MS } from "../src/lib/memo";

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
