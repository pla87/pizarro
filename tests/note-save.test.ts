// Guardado automático de las notas de Documentación (note-save.ts): espera según el tamaño y errores que lo paran.
import assert from "node:assert/strict";
import { test } from "node:test";
import { noteSaveDelay, noteSaveStop, noteStillStopped } from "../src/components/docs/note-save";
import { NOTE_MAX_CHARS } from "../src/lib/document-kind";

test("cuanto más larga la nota, más espera antes de guardar", () => {
  assert.equal(noteSaveDelay(0), 1200);
  assert.equal(noteSaveDelay(20_000), 1200);
  assert.equal(noteSaveDelay(20_001), 3000);
  assert.equal(noteSaveDelay(100_000), 3000);
  assert.equal(noteSaveDelay(150_000), 5000);
});

test("papelera, cuota y tope paran el guardado; lo demás (red, error raro) se reintenta", () => {
  assert.deepEqual(noteSaveStop("note_trashed", 10), { reason: "trashed" });
  assert.deepEqual(noteSaveStop("note_too_long", 10), { reason: "too_long" });
  assert.deepEqual(noteSaveStop("quota_project", 500), { reason: "quota", chars: 500 });
  assert.deepEqual(noteSaveStop("quota_total", 500), { reason: "quota", chars: 500 });
  assert.equal(noteSaveStop(undefined, 10), null);
  assert.equal(noteSaveStop("edit_conflict", 10), null);
});

test("el guardado vuelve solo cuando el texto ya cabe; la papelera, nunca desde el editor", () => {
  assert.equal(noteStillStopped({ reason: "too_long" }, "x".repeat(NOTE_MAX_CHARS + 1)), true);
  assert.equal(noteStillStopped({ reason: "too_long" }, "x".repeat(NOTE_MAX_CHARS)), false);
  assert.equal(noteStillStopped({ reason: "quota", chars: 500 }, "x".repeat(600)), true);
  assert.equal(noteStillStopped({ reason: "quota", chars: 500 }, "x".repeat(500)), true);
  assert.equal(noteStillStopped({ reason: "quota", chars: 500 }, "x".repeat(499)), false);
  assert.equal(noteStillStopped({ reason: "trashed" }, ""), true);
});
