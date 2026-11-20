// Presencia por el canal en vivo (src/lib/presence.ts): quién está en el tablero y quién tiene abierta cada tarea, sin
// sondeos. El canal cuenta como «tablero a la vista» mientras está abierto; la tarea anunciada con el id del canal dura
// lo que el canal o hasta cerrarla; los cambios avisan a los canales del proyecto (agrupados).
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  activeUsers,
  closePresenceStream,
  dropUserPresence,
  hasPresenceEntry,
  holdTaskView,
  leavePresence,
  notePresence,
  noteTaskViewer,
  openPresenceStream,
  openTaskViewers,
  presenceJson,
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
  assert.equal(holdTaskView(a, "ub", "t1", "pp-2", "m1"), false, "el canal de otra persona no vale");
  assert.equal(holdTaskView(a, "ua", "t1", "otro", "m1"), false, "una tarea de otro proyecto no vale");
  assert.equal(holdTaskView(a, "ua", "t1", "pp-2", "m1"), true);
  assert.equal(holdTaskView(b, "ub", "t1", "pp-2", "m1"), true);
  assert.deepEqual(taskViewersExcept("t1", "pp-2", "ua"), [{ id: "ub", name: "Bea" }]);
  assert.deepEqual(presenceSnapshot("pp-2").viewers, { t1: [{ id: "ua", name: "Ana" }, { id: "ub", name: "Bea" }] });
  releaseTaskView(b, "ub", "t1", "m1");
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
  holdTaskView(s1, "ud", "t4", "pp-4", "m1");
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

test("abrir y cerrar muy deprisa: si el cierre llega antes que el anuncio, gana el cierre", () => {
  const now = Date.now();
  const a = openPresenceStream("pp-5", "ue", "Eva", now);
  releaseTaskView(a, "ue", "t5", "o1", now); // el DELETE adelanta al GET
  assert.equal(holdTaskView(a, "ue", "t5", "pp-5", "o1", now + 50), true, "el canal es válido: no se cae al aviso con caducidad");
  assert.deepEqual(presenceSnapshot("pp-5", now + 100).viewers, {}, "la tarea no queda retenida");
  // Volver a abrirla después sí cuenta (otro montaje del diálogo, otro id).
  assert.equal(holdTaskView(a, "ue", "t5", "pp-5", "o2", now + 200), true);
  assert.deepEqual(presenceSnapshot("pp-5", now + 300).viewers, { t5: [{ id: "ue", name: "Eva" }] });
  // Un cierre adelantado antiguo (más de unos segundos) no impide abrirla.
  releaseTaskView(a, "ue", "t5", "o2", now + 400);
  releaseTaskView(a, "ue", "t6", "o3", now + 400);
  assert.equal(holdTaskView(a, "ue", "t6", "pp-5", "o3", now + 60_000), true);
  assert.deepEqual(Object.keys(presenceSnapshot("pp-5", now + 60_000).viewers), ["t6"]);
  closePresenceStream(a, now + 60_000);
});

test("cerrar y reabrir la misma tarea con el primer anuncio en vuelo (GET1, GET2, DELETE1): sigue abierta", () => {
  const now = Date.now();
  const a = openPresenceStream("pp-13", "ul", "Lola", now);
  holdTaskView(a, "ul", "t13", "pp-13", "m1", now);
  holdTaskView(a, "ul", "t13", "pp-13", "m2", now + 1);
  releaseTaskView(a, "ul", "t13", "m1", now + 2);
  assert.deepEqual(presenceSnapshot("pp-13", now + 3).viewers, { t13: [{ id: "ul", name: "Lola" }] });
  releaseTaskView(a, "ul", "t13", "m2", now + 4);
  assert.deepEqual(presenceSnapshot("pp-13", now + 5).viewers, {}, "cerrados los dos montajes, deja de estar abierta");
  closePresenceStream(a, now + 6);
});

test("el cierre adelantado de un montaje no se lo come el anuncio del siguiente", () => {
  const now = Date.now();
  const a = openPresenceStream("pp-14", "um", "Mar", now);
  releaseTaskView(a, "um", "t14", "m1", now); // GET1 falló: su DELETE llega sin anuncio
  holdTaskView(a, "um", "t14", "pp-14", "m2", now + 100);
  assert.deepEqual(presenceSnapshot("pp-14", now + 200).viewers, { t14: [{ id: "um", name: "Mar" }] });
  closePresenceStream(a, now + 300);
});

test("con varios montajes de la misma tarea solo avisa al abrirse el primero y al cerrarse el último", async () => {
  let calls = 0;
  const a = openPresenceStream("pp-15", "un", "Nora");
  const off = subscribePresence("pp-15", () => calls++);
  holdTaskView(a, "un", "t15", "pp-15", "m1");
  await settle();
  assert.equal(calls, 1);
  holdTaskView(a, "un", "t15", "pp-15", "m2");
  releaseTaskView(a, "un", "t15", "m1");
  await settle();
  assert.equal(calls, 1, "sigue abierta: no cambia nada");
  releaseTaskView(a, "un", "t15", "m2");
  await settle();
  assert.equal(calls, 2);
  off();
  closePresenceStream(a);
});

test("los canales reciben el estado ya en JSON, el mismo para todos los del proyecto", async () => {
  const got: string[][] = [[], []];
  const offs = got.map((list) => subscribePresence("pp-6", (json) => list.push(json)));
  const s = openPresenceStream("pp-6", "uf", "Fran");
  await settle();
  assert.equal(got[0]!.length, 1);
  assert.equal(got[0]![0], presenceJson("pp-6"));
  assert.deepEqual(got[1], got[0]);
  assert.deepEqual(JSON.parse(got[0]![0]!).users, [{ id: "uf", name: "Fran" }]);
  for (const off of offs) off();
  closePresenceStream(s);
});

test("la actividad caducada de proyectos que nadie consulta se barre al anotar otra", () => {
  const now = Date.now() + 3_600_000;
  notePresence("pp-7", "ug", "Gala", now);
  assert.equal(hasPresenceEntry("pp-7"), true);
  notePresence("pp-8", "uh", "Hugo", now + 6 * 60_000);
  assert.equal(hasPresenceEntry("pp-7"), false, "pp-7 caducó y nadie lo ha consultado: se barre igualmente");
  assert.equal(hasPresenceEntry("pp-8"), true);
});

test("al cerrar sesión deja de contar al momento, salvo donde tenga otro canal abierto", () => {
  const other = openPresenceStream("pp-10", "ui", "Iris");
  notePresence("pp-9", "ui", "Iris");
  noteTaskViewer("t9b", "pp-9", "ui", "Iris");
  const s = openPresenceStream("pp-9", "ui", "Iris");
  closePresenceStream(s); // revokeSessionStreams: el canal se cierra (y la anotaría 5 minutos)
  leavePresence("ui");
  assert.deepEqual(activeUsers("pp-9"), [], "sin persona fantasma tras cerrar sesión");
  assert.deepEqual(presenceSnapshot("pp-9").viewers, {}, "ni tarea abierta");
  assert.deepEqual(activeUsers("pp-10").map((u) => u.id), ["ui"], "otro dispositivo con el tablero abierto: sigue");
  closePresenceStream(other);
});

test("tareas abiertas del sondeo de respaldo: solo las del proyecto pedido", () => {
  noteTaskViewer("t11a", "pp-11", "uj", "Juan");
  noteTaskViewer("t11b", "pp-12", "uj", "Juan");
  const s = openPresenceStream("pp-11", "uk", "Kira");
  holdTaskView(s, "uk", "t11c", "pp-11", "m1");
  assert.deepEqual([...openTaskViewers("pp-11", "nadie").keys()].sort(), ["t11a", "t11c"]);
  assert.deepEqual([...openTaskViewers("pp-11", "uk").keys()], ["t11a"], "sin la propia persona");
  closePresenceStream(s);
});
