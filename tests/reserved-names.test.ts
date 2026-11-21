// Nombres de persona reservados (los que imitan a Pizarro o a su administración): reserved-names.ts.
import assert from "node:assert/strict";
import { test } from "node:test";
import { isReservedName } from "../src/lib/reserved-names";

test("nombres reservados: sin distinguir mayúsculas, tildes, espacios ni signos, en español y en inglés", () => {
  for (const name of [
    "Pizarro", "PIZARRO", " pizarro ", "Pi zarro", "Sistema", "System", "Administración", "administracion", "ADMINISTRACIÓN.",
    "Administrador del sistema", "Administrador  del  Sistema", "administradordelsistema", "System Administrator", "Soporte",
    "Soporte técnico", "Soporte-Técnico", "Support", "Pizarro Support", "Equipo de Pizarro", "Seguridad", "Notificaciones",
    "No-reply", "noreply", "Sÿstem", "Ｐｉｚａｒｒｏ",
  ]) {
    assert.equal(isReservedName(name), true, name);
  }
});

test("nombres reservados: los de persona siguen valiendo, «Administrador» incluido (SEED_ADMIN_NAME y /setup)", () => {
  for (const name of ["Administrador", "Administradora", "Administrator", "Admin", "Ana Pizarro", "Francisco Pizarro", "Ana de Soporte", "Sistemas Ana", "Seguridad Social Pérez", "Bea", "Sistemas"]) {
    assert.equal(isReservedName(name), false, name);
  }
});
