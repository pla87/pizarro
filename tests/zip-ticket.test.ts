// Vales de descarga del ZIP de adjuntos (src/lib/zip-ticket.ts): de quien los pidió, con un tope por persona (al pasarse
// se va el más antiguo de esa persona, no los de las demás) y reutilizados si se pide otra vez la misma lista.
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

test("la misma lista de la misma persona reutiliza el vale (y empieza de cero); otra lista u otra persona, no", () => {
  const now = Date.now();
  const a = issueZipTicket("zt-r", "p2", items(1), now);
  const tk = findZipTicket(a, "zt-r", "p2", now)!;
  tk.started(1);
  tk.failed(1, 409, "cambió");
  assert.equal(issueZipTicket("zt-r", "p2", items(1), now + 1), a);
  assert.deepEqual(findZipTicket(a, "zt-r", "p2", now + 2)!.status(), { started: [], done: [], errors: {} });
  assert.notEqual(issueZipTicket("zt-r", "p2", items(2), now + 3), a);
  assert.notEqual(issueZipTicket("zt-r", "p3", items(1), now + 3), a);
  assert.notEqual(issueZipTicket("zt-s", "p2", items(1), now + 3), a);
  assert.equal(findZipTicket(a, "zt-s", "p2", now + 4), null, "el vale es de quien lo pidió");
});
