// Vales de descarga del ZIP de adjuntos (src/lib/zip-ticket.ts): de quien los pidió, uno nuevo en cada petición (aunque
// sea la misma lista: otra pestaña puede seguir usando el anterior) y con un tope por persona (al pasarse se van primero
// los suyos sin actividad, no los de las demás ni la descarga en curso).
import assert from "node:assert/strict";
import { test } from "node:test";
import { findZipTicket, issueZipTicket } from "../src/lib/zip-ticket";

const items = (n: number) => [{ taskId: `t${n}`, code: `A${n}` }];

test("tope por persona: una sola persona no expulsa los vales en curso de otras", () => {
  const now = Date.now();
  const other = issueZipTicket("zt-otra", "p1", items(0), now);
  const mine: string[] = [];
  for (let i = 1; i <= 600; i++) mine.push(issueZipTicket("zt-yo", "p1", items(i), now + i));
  assert.ok(findZipTicket(other, "zt-otra", "p1", now + 700), "el vale de la otra persona sigue");
  const alive = mine.filter((id) => findZipTicket(id, "zt-yo", "p1", now + 700));
  assert.deepEqual(alive, mine.slice(-5), "de los míos quedan los 5 más recientes");
});

test("la misma lista otra vez (otra pestaña) da un vale nuevo y no toca el que sigue en uso", () => {
  const now = Date.now();
  const a = issueZipTicket("zt-r", "p2", items(1), now);
  const tk = findZipTicket(a, "zt-r", "p2", now)!;
  tk.started(1);
  tk.finished(1);
  tk.started(2);
  const b = issueZipTicket("zt-r", "p2", items(1), now + 1);
  assert.notEqual(b, a);
  assert.deepEqual(findZipTicket(a, "zt-r", "p2", now + 2)!.status(), { started: [1, 2], done: [1], errors: {} });
  findZipTicket(b, "zt-r", "p2", now + 3)!.failed(1, 429, "ocupado");
  assert.deepEqual(findZipTicket(a, "zt-r", "p2", now + 4)!.status().errors, {}, "el 429 del vale nuevo no llega al otro");
  assert.deepEqual(findZipTicket(b, "zt-r", "p2", now + 4)!.status(), { started: [], done: [], errors: { 1: { status: 429, message: "ocupado" } } });
  assert.equal(findZipTicket(a, "zt-s", "p2", now + 5), null, "el vale es de quien lo pidió");
});

test("al pasar del tope se va primero un vale sin actividad, no la descarga en curso aunque sea la más antigua", () => {
  const now = Date.now();
  const busy = issueZipTicket("zt-t", "p4", items(1), now);
  findZipTicket(busy, "zt-t", "p4", now)!.started(1);
  const idle: string[] = [];
  for (let i = 2; i <= 5; i++) idle.push(issueZipTicket("zt-t", "p4", items(i), now + i));
  // Dos minutos después (la descarga sigue: empezada y sin terminar), otro plan.
  const later = now + 120_000;
  const fresh = issueZipTicket("zt-t", "p4", items(9), later);
  assert.ok(findZipTicket(busy, "zt-t", "p4", later), "la descarga en curso sigue");
  assert.equal(findZipTicket(idle[0]!, "zt-t", "p4", later), null, "se fue el más antiguo sin actividad");
  assert.ok(findZipTicket(fresh, "zt-t", "p4", later));
  // Todos recientes: se va el más antiguo.
  const now2 = later + 1_000_000;
  const all: string[] = [];
  for (let i = 0; i < 6; i++) all.push(issueZipTicket("zt-u", "p4", items(i), now2 + i));
  assert.deepEqual(all.filter((id) => findZipTicket(id, "zt-u", "p4", now2 + 10)), all.slice(1));
});
