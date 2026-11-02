import assert from "node:assert/strict";
import { test } from "node:test";
import { EN } from "../src/i18n/en";
import { makeT } from "../src/i18n/core";
import { localeFromAcceptLanguage, pickLandingLocale } from "../src/lib/landing-locale";
import { addTask, moveTask, parseState, releaseMarkdown, removeTask, seedState, seedStrings, toggleSub } from "../src/lib/landing-demo";

const TODAY = "2026-03-10";

test("idioma de la presentación: ?lang manda, luego el navegador, luego la instalación", () => {
  assert.equal(pickLandingLocale({ lang: "en", acceptLanguage: "es-ES", fallback: "es" }), "en");
  assert.equal(pickLandingLocale({ lang: "xx", acceptLanguage: "en-GB,en;q=0.8", fallback: "es" }), "en");
  assert.equal(pickLandingLocale({ acceptLanguage: "fr-FR,fr;q=0.9", fallback: "en" }), "en");
  assert.equal(pickLandingLocale({ acceptLanguage: null, fallback: "es" }), "es");
  assert.equal(localeFromAcceptLanguage("fr;q=0.9, es;q=0.5, en;q=0.7"), "en");
  assert.equal(localeFromAcceptLanguage("en;q=0, es"), "es");
  assert.equal(localeFromAcceptLanguage("*"), null);
});

test("demo: mover una tarjeta entre columnas y dentro de la misma", () => {
  const s = seedState(TODAY);
  const moved = moveTask(s, "t1", "c2", 0, TODAY);
  assert.deepEqual(moved.columns[0]!.taskIds, ["t2"]);
  assert.deepEqual(moved.columns[1]!.taskIds, ["t1", "t3", "t4"]);
  // Dentro de la columna: bajar la primera por detrás de la segunda.
  const same = moveTask(s, "t6", "c4", 2, TODAY);
  assert.deepEqual(same.columns[3]!.taskIds, ["t7", "t8", "t6"]);
  assert.equal(moveTask(s, "nope", "c2").columns, s.columns);
});

test("demo: la columna «Esperando» cuenta los días desde que entra la tarjeta", () => {
  const s = seedState(TODAY);
  const waiting = moveTask(s, "t1", "c3", undefined, TODAY);
  assert.equal(waiting.tasks.t1!.since, TODAY);
  const out = moveTask(waiting, "t1", "c1", undefined, TODAY);
  assert.equal(out.tasks.t1!.since, null);
  assert.equal(s.tasks.t5!.since, "2026-03-06");
});

test("demo: crear tarea, marcar subtareas y borrar", () => {
  let s = addTask(seedState(TODAY), "c1", "  Mi tarea  ", TODAY);
  const id = s.columns[0]!.taskIds.at(-1)!;
  assert.equal(s.tasks[id]!.title, "Mi tarea");
  assert.equal(s.tasks[id]!.custom, true);
  assert.equal(addTask(s, "c1", "   ", TODAY), s);
  s = toggleSub(s, "t1", "t1s1");
  assert.equal(s.tasks.t1!.subs[1]!.done, true);
  s = removeTask(s, id);
  assert.equal(s.tasks[id], undefined);
  assert.ok(!s.columns[0]!.taskIds.includes(id));
});

test("demo: las notas de release salen de «Siguiente salto», por tipo y en cada idioma", () => {
  const s = seedState(TODAY);
  const es = releaseMarkdown(s, makeT("es"), TODAY);
  assert.equal(es, "# Release 2026-03-10\n\n## Funcionalidad\n- Recordatorio por email un día antes\n\n## Corrección\n- Corregir el cálculo de huecos libres\n\n## Mejora\n- Mejorar el contraste de los botones\n");
  const en = releaseMarkdown(s, makeT("en"), TODAY);
  assert.match(en, /## Feature\n- Email reminder one day before/);
  assert.match(en, /## Bug fix\n- Fix the free-slot calculation/);
  // Sin tareas en la columna no hay nada que generar; y al mover una, entra en las notas.
  const empty = ["t6", "t7", "t8"].reduce((acc, id) => moveTask(acc, id, "c1", undefined, TODAY), s);
  assert.equal(releaseMarkdown(empty, makeT("es"), TODAY), "");
  assert.match(releaseMarkdown(moveTask(empty, "t3", "c4", undefined, TODAY), makeT("es"), TODAY), /- Buscador de reservas por nombre/);
});

test("demo: el estado guardado se valida antes de usarlo", () => {
  const s = seedState(TODAY);
  assert.deepEqual(parseState(JSON.stringify(s)), s);
  assert.equal(parseState(null), null);
  assert.equal(parseState("{no json"), null);
  assert.equal(parseState(JSON.stringify({ ...s, columns: [{ id: "c1", name: "x", role: "NONE", taskIds: ["fantasma"] }] })), null);
  // Una tarjeta repetida en dos columnas o una tarea huérfana invalidan el estado.
  assert.equal(parseState(JSON.stringify({ ...s, columns: [{ ...s.columns[0]!, taskIds: ["t1", "t1"] }] })), null);
});

test("demo: todos los textos de ejemplo tienen traducción al inglés", () => {
  for (const text of seedStrings()) assert.ok(text in EN, `falta la traducción de «${text}»`);
});
