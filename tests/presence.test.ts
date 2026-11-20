// Presencia por el canal en vivo (src/lib/presence.ts): quién está en el tablero y quién tiene abierta cada tarea, sin
// sondeos. El canal cuenta como «tablero a la vista» mientras está abierto; la tarea anunciada con el id del canal dura
// lo que el canal o hasta cerrarla; los cambios avisan a los canales del proyecto (agrupados).
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  activeUsers,
  closePresenceStream,
  dropUserPresence,
  holdTaskView,
  noteTaskViewer,
  openPresenceStream,
  presenceSnapshot,
  releaseTaskView,
  subscribePresence,
  taskViewersExcept,
} from "../src/lib/presence";

const settle = () => new Promise((r) => setTimeout(r, 260));

test("un canal abierto cuenta como presencia y, al cerrarse, la persona sigue 5 minutos", () => {
  const now = Date.now();
  const s = openPresenceStream("pp-1", "u1", "Uno", now);
  assert.deepEqual(activeUsers("pp-1", now + 10 * 60_000).map((u) => u.id), ["u1"], "con el canal abierto no caduca");
  closePresenceStream(s, now + 10 * 60_000);
  closePresenceStream(s, now + 10 * 60_000); // dos veces: sin efecto
  assert.deepEqual(activeUsers("pp-1", now + 14 * 60_000).map((u) => u.id), ["u1"]);
  assert.deepEqual(activeUsers("pp-1", now + 16 * 60_000), []);
});

test("la tarea anunciada con el canal: solo del mismo usuario y proyecto, hasta cerrarla o cerrar el canal", () => {
  const a = openPresenceStream("pp-2", "ua", "Ana");
  const b = openPresenceStream("pp-2", "ub", "Bea");
  assert.equal(holdTaskView(a, "ub", "t1", "pp-2"), false, "el canal de otra persona no vale");
  assert.equal(holdTaskView(a, "ua", "t1", "otro"), false, "una tarea de otro proyecto no vale");
  assert.equal(holdTaskView(a, "ua", "t1", "pp-2"), true);
  assert.equal(holdTaskView(b, "ub", "t1", "pp-2"), true);
  assert.deepEqual(taskViewersExcept("t1", "pp-2", "ua"), [{ id: "ub", name: "Bea" }]);
  assert.deepEqual(presenceSnapshot("pp-2").viewers, { t1: [{ id: "ua", name: "Ana" }, { id: "ub", name: "Bea" }] });
  releaseTaskView(b, "ub", "t1");
  assert.deepEqual(taskViewersExcept("t1", "pp-2", "ua"), []);
  closePresenceStream(a);
  assert.deepEqual(presenceSnapshot("pp-2").viewers, {}, "al cerrarse el canal deja de tenerla abierta");
  closePresenceStream(b);
});

test("sin canal, el aviso de la tarea dura 45 s y sale en el estado del proyecto", () => {
  const now = Date.now();
  noteTaskViewer("t9", "pp-3", "uc", "Carla", now);
  assert.deepEqual(presenceSnapshot("pp-3", now + 1000).viewers, { t9: [{ id: "uc", name: "Carla" }] });
  assert.deepEqual(presenceSnapshot("pp-3", now + 46_000).viewers, {});
  assert.deepEqual(presenceSnapshot("otro-proyecto", now + 1000).viewers, {}, "nunca en el estado de otro proyecto");
});

test("los cambios avisan a los canales del proyecto (agrupados) y quitar a alguien lo saca al momento", async () => {
  let calls = 0;
  const off = subscribePresence("pp-4", () => calls++);
  const s1 = openPresenceStream("pp-4", "ud", "Dani");
  const s2 = openPresenceStream("pp-4", "ud", "Dani"); // otra pestaña de la misma persona: nada nuevo
  holdTaskView(s1, "ud", "t4", "pp-4");
  await settle();
  assert.equal(calls, 1, "varios cambios seguidos, un solo aviso");
  dropUserPresence("ud");
  await settle();
  assert.equal(calls, 2);
  assert.deepEqual(presenceSnapshot("pp-4"), { users: [], viewers: {} });
  off();
  closePresenceStream(s1);
  closePresenceStream(s2);
});
