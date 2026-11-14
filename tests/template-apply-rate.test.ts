// Límites de «Aplicar plantilla»: por proyecto, por persona y de la vista previa (lib/template-apply-rate.ts).
import assert from "node:assert/strict";
import { mock, test } from "node:test";
import { markTemplateChangeSpent, releaseTemplateChange, reserveTemplateChange, reserveTemplatePreview, shouldReleaseTemplateChange, TEMPLATE_CHANGE_LIMITS } from "../src/lib/template-apply-rate";

test("los valores de los límites son los acordados", () => {
  assert.deepEqual(TEMPLATE_CHANGE_LIMITS, {
    project: { limit: 5, windowMs: 600_000 },
    user: { limit: 20, windowMs: 3_600_000 },
    preview: { limit: 60, windowMs: 600_000 },
  });
});

test("como mucho 5 cambios por proyecto cada 10 minutos; el aviso dice cuándo volver a intentarlo", () => {
  mock.timers.enable({ apis: ["Date"], now: 1_000_000 });
  try {
    for (let i = 0; i < 5; i++) assert.equal(reserveTemplateChange("rate-u1", "rate-p1"), null, `cambio ${i + 1}`);
    const notice = reserveTemplateChange("rate-u1", "rate-p1");
    assert.equal(notice?.text, "Este proyecto ya ha cambiado de plantilla {n} veces en los últimos {w} minutos. Vuelve a intentarlo dentro de {min} min.");
    assert.deepEqual(notice?.vars, { n: 5, w: 10, min: 10 });
    // Otra persona en el mismo proyecto, tampoco (el límite es del proyecto).
    assert.ok(reserveTemplateChange("rate-u2", "rate-p1"));
    // La misma persona en otro proyecto, sí.
    assert.equal(reserveTemplateChange("rate-u1", "rate-p2"), null);
    // Pasados 4 minutos faltan 6; pasados los 10, vuelve a poder.
    mock.timers.tick(4 * 60_000);
    assert.equal(reserveTemplateChange("rate-u1", "rate-p1")?.vars.min, 6);
    mock.timers.tick(6 * 60_000 + 1);
    assert.equal(reserveTemplateChange("rate-u1", "rate-p1"), null);
  } finally {
    mock.timers.reset();
  }
});

test("como mucho 20 cambios por persona y hora, sumando todos sus proyectos; un rechazo no gasta nada", () => {
  mock.timers.enable({ apis: ["Date"], now: 50_000_000 });
  try {
    for (let i = 0; i < 20; i++) assert.equal(reserveTemplateChange("rate-u3", `rate-q${i % 4}`), null, `cambio ${i + 1}`);
    const notice = reserveTemplateChange("rate-u3", "rate-q9");
    assert.equal(notice?.text, "Ya has aplicado o deshecho {n} plantillas en la última hora. Vuelve a intentarlo dentro de {min} min.");
    assert.equal(notice?.vars.n, 20);
    // El rechazo por persona no ha contado en el proyecto nuevo: otra persona puede usarlo entero.
    for (let i = 0; i < 5; i++) assert.equal(reserveTemplateChange("rate-u4", "rate-q9"), null);
  } finally {
    mock.timers.reset();
  }
});

test("un cambio que no llega a hacerse devuelve su reserva", () => {
  mock.timers.enable({ apis: ["Date"], now: 90_000_000 });
  try {
    for (let i = 0; i < 5; i++) assert.equal(reserveTemplateChange("rate-u5", "rate-r1"), null);
    assert.ok(reserveTemplateChange("rate-u5", "rate-r1"));
    releaseTemplateChange("rate-u5", "rate-r1");
    assert.equal(reserveTemplateChange("rate-u5", "rate-r1"), null);
  } finally {
    mock.timers.reset();
  }
});

test("solo se devuelve la reserva de un aviso anterior al cambio: no la de uno que ya se ejecutó ni la de un fallo inesperado", () => {
  const before = new Error("No hay ningún cambio de plantilla que deshacer.");
  assert.equal(shouldReleaseTemplateChange(before, true), true);
  assert.equal(shouldReleaseTemplateChange(new Error("timeout"), false), false);
  // El cambio ya se había hecho en la transacción cuando falló (p. ej. el tope de la columna «Programa»): queda gastada.
  const late = markTemplateChangeSpent(new Error("La columna «Por hacer» tiene 101 tareas…"));
  assert.equal(shouldReleaseTemplateChange(late, true), false);
  assert.equal(markTemplateChangeSpent("texto"), "texto");
  assert.equal(shouldReleaseTemplateChange("texto", true), true);
});

test("la vista previa tiene su propio límite, más alto (60 cada 10 minutos)", () => {
  mock.timers.enable({ apis: ["Date"], now: 130_000_000 });
  try {
    for (let i = 0; i < 60; i++) assert.equal(reserveTemplatePreview("rate-u6"), null);
    assert.equal(reserveTemplatePreview("rate-u6")?.text, "Demasiadas vistas previas de plantillas seguidas. Vuelve a intentarlo dentro de {min} min.");
    // No gasta los cambios de plantilla.
    assert.equal(reserveTemplateChange("rate-u6", "rate-s1"), null);
  } finally {
    mock.timers.reset();
  }
});
