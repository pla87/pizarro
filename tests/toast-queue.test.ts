// Cola de avisos (src/components/ui/toast-queue.ts): con muchos avisos seguidos no se cae el de sesión caducada.
import assert from "node:assert/strict";
import { test } from "node:test";
import { MAX_TOASTS, placeToast, pushToast, toastMs, trimToasts } from "../src/components/ui/toast-queue";

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

test("los avisos con «Deshacer» duran al menos 10 s; los errores y otros con botón, 6 s; los demás, 2,5 s", () => {
  assert.ok(toastMs("undo", true) >= 10000);
  assert.equal(toastMs("error", false), 6000);
  assert.equal(toastMs("success", true), 6000);
  assert.equal(toastMs("undo", false), 2500);
  assert.equal(toastMs("success", false), 2500);
});

type Item = { id: number; kind: "success" | "error" | "undo"; action?: { independent?: boolean }; stale?: boolean; group?: string };
const undo = (id: number, independent = false): Item => ({ id, kind: "undo", action: { independent } });

test("un aviso nuevo con «Deshacer» apaga el «Deshacer» de los anteriores (salvo los independientes)", () => {
  let items: Item[] = [];
  items = placeToast(items, undo(1));
  items = placeToast(items, undo(2, true)); // «Adjunto borrado»: deshace ese borrado aunque no sea lo último
  items = placeToast(items, { id: 3, kind: "success" });
  items = placeToast(items, undo(4));
  assert.deepEqual(items.map((x) => [x.id, !!x.stale]), [[1, true], [2, false], [3, false], [4, false]]);
  // «Deshecho: …» (sin botón) no apaga nada: el último sigue sirviendo.
  items = placeToast(items, { id: 5, kind: "undo" });
  assert.equal(items.find((x) => x.id === 4)!.stale, undefined);
});

test("avisos de un mismo grupo se sustituyen en su sitio (Alt+flechas en una columna): ni se apilan ni se mueven", () => {
  let items: Item[] = [{ id: 1, kind: "success" }];
  items = placeToast(items, { id: 2, kind: "success", group: "column-move" });
  items = placeToast(items, { id: 3, kind: "success" });
  items = placeToast(items, { id: 4, kind: "success", group: "column-move" });
  items = placeToast(items, { id: 5, kind: "success", group: "column-move" });
  // Id nuevo (el lector de pantalla lo anuncia otra vez), en el hueco del anterior.
  assert.deepEqual(ids(items), [1, 5, 3]);
});

test("con el ratón encima de la pila no se recorta (max sin tope) y al salir vuelve a MAX_TOASTS", () => {
  let items: Item[] = [];
  for (let id = 1; id <= 6; id++) items = placeToast(items, { id, kind: "success" }, null, Infinity);
  assert.equal(items.length, 6);
  assert.deepEqual(ids(trimToasts(items, 1)), [1, 4, 5, 6]);
  assert.equal(trimToasts(items).length, MAX_TOASTS);
});
