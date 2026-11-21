// «Invitar por email» desde un proyecto (src/lib/project-invite.ts): nombre provisional a partir del email y proyecto
// guardado en la invitación.
import assert from "node:assert/strict";
import { test } from "node:test";
import { inviteProjectId, nameFromEmail } from "../src/lib/project-invite";

test("nameFromEmail: la parte de antes de la arroba, con separadores como espacios y cada palabra en mayúscula", () => {
  assert.equal(nameFromEmail("ana.garcia@example.com"), "Ana Garcia");
  assert.equal(nameFromEmail("luis_perez-gil@example.com"), "Luis Perez Gil");
  assert.equal(nameFromEmail("bea+pizarro@example.com"), "Bea");
  assert.equal(nameFromEmail("x@example.com"), "X");
  // Un nombre reservado («Soporte», «Pizarro»…): el email entero, que no se confunde con un mensaje del sistema.
  assert.equal(nameFromEmail("soporte@example.com"), "soporte@example.com");
  assert.equal(nameFromEmail("pizarro+x@example.com"), "pizarro+x@example.com");
  assert.equal(nameFromEmail("ana.pizarro@example.com"), "Ana Pizarro");
  // Sin nada aprovechable antes de la arroba, el email entero (recortado al máximo de un nombre).
  assert.equal(nameFromEmail("..@example.com"), "..@example.com");
  assert.equal(nameFromEmail(`${"a".repeat(120)}@example.com`).length, 80);
});

test("inviteProjectId: solo un id con forma de id; cualquier otra cosa es una invitación sin proyecto", () => {
  assert.equal(inviteProjectId({ projectId: "cm123abc" }), "cm123abc");
  assert.equal(inviteProjectId(null), null);
  assert.equal(inviteProjectId(undefined), null);
  assert.equal(inviteProjectId("cm123abc"), null);
  assert.equal(inviteProjectId(["cm123abc"]), null);
  assert.equal(inviteProjectId({ projectId: 5 }), null);
  assert.equal(inviteProjectId({ projectId: "../admin" }), null);
  assert.equal(inviteProjectId({ projectId: "" }), null);
});
