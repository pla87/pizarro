// Cola de avisos (src/components/ui/toast-queue.ts): con muchos avisos seguidos no se cae el de sesión caducada.
import assert from "node:assert/strict";
import { test } from "node:test";
import { MAX_TOASTS, pushToast } from "../src/components/ui/toast-queue";

const ids = (xs: { id: number }[]) => xs.map((x) => x.id);

test("como mucho MAX_TOASTS avisos: se van los más antiguos", () => {
  let items: { id: number }[] = [];
  for (let id = 1; id <= 6; id++) items = pushToast(items, { id });
  assert.equal(items.length, MAX_TOASTS);
  assert.deepEqual(ids(items), [3, 4, 5, 6]);
});

test("el aviso de sesión caducada no se recorta aunque lleguen más de 3 avisos después", () => {
  let items: { id: number }[] = [];
  items = pushToast(items, { id: 1 });
  items = pushToast(items, { id: 2 }, 2); // sesión caducada
  for (let id = 3; id <= 9; id++) items = pushToast(items, { id }, 2);
  assert.equal(items.length, MAX_TOASTS);
  assert.ok(ids(items).includes(2), "sigue visible «Iniciar sesión»");
  assert.deepEqual(ids(items), [2, 7, 8, 9]);
});

test("al llegar el aviso de sesión se quitan los más antiguos, no él", () => {
  let items: { id: number }[] = [];
  for (let id = 1; id <= 4; id++) items = pushToast(items, { id });
  items = pushToast(items, { id: 5 }, 5);
  assert.deepEqual(ids(items), [2, 3, 4, 5]);
  // Sin aviso fijado (ya se cerró), vuelve a ser una cola normal.
  assert.deepEqual(ids(pushToast(items, { id: 6 }, null)), [3, 4, 5, 6]);
});

test("no muta la lista anterior (estado de React)", () => {
  const prev = Object.freeze([{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }]);
  const next = pushToast(prev, { id: 5 });
  assert.deepEqual(ids([...prev]), [1, 2, 3, 4]);
  assert.deepEqual(ids(next), [2, 3, 4, 5]);
});
