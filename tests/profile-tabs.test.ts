import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveProfileTab } from "../src/app/(app)/settings/profile-tabs";

test("pestañas de «Mi perfil»: valor válido, y «Cuenta» si falta o es desconocido", () => {
  const tab = (v: unknown) => resolveProfileTab(v).tab;
  assert.equal(tab("preferencias"), "preferencias");
  assert.equal(tab("plantillas"), "plantillas");
  assert.equal(tab("avisos"), "avisos");
  assert.equal(tab("cuenta"), "cuenta");
  assert.equal(tab(undefined), "cuenta");
  assert.equal(tab("otra"), "cuenta");
  assert.equal(tab(["avisos"]), "cuenta");
});

test("pestañas: alias sin mayúsculas ni tildes, y aviso con una desconocida (ronda 56)", async () => {
  const { resolveProjectSettingsTab } = await import("../src/app/(app)/p/[projectId]/settings/project-settings-tabs");
  assert.deepEqual(resolveProfileTab(undefined), { tab: "cuenta", kind: "default" });
  assert.deepEqual(resolveProfileTab("avisos"), { tab: "avisos", kind: "exact" });
  assert.deepEqual(resolveProfileTab("Notificaciones"), { tab: "avisos", kind: "alias" });
  assert.deepEqual(resolveProfileTab("MENSAJERÍA"), { tab: "avisos", kind: "alias" });
  assert.deepEqual(resolveProfileTab("zzz"), { tab: "cuenta", kind: "unknown", asked: "zzz" });
  // Ajustes del proyecto: «Plantillas» tiene el id «releases» (enlaces guardados), pero su nombre también vale.
  assert.deepEqual(resolveProjectSettingsTab("plantillas", true), { tab: "releases", kind: "alias" });
  assert.deepEqual(resolveProjectSettingsTab("releases", false), { tab: "releases", kind: "exact" });
  assert.deepEqual(resolveProjectSettingsTab("Límites", true), { tab: "adjuntos", kind: "alias" });
  // Quien no gestiona el proyecto no tiene «General»: cuenta como desconocida (la página dice que es de gestión).
  assert.deepEqual(resolveProjectSettingsTab("general", false), { tab: "tablero", kind: "unknown", asked: "general" });
  assert.equal(resolveProjectSettingsTab("x".repeat(500), true).asked?.length, 40);
});
