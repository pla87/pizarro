import assert from "node:assert/strict";
import { test } from "node:test";
import { parseProfileTab } from "../src/app/(app)/settings/profile-tabs";

test("pestañas de «Mi perfil»: valor válido, y «Cuenta» si falta o es desconocido", () => {
  assert.equal(parseProfileTab("preferencias"), "preferencias");
  assert.equal(parseProfileTab("avisos"), "avisos");
  assert.equal(parseProfileTab("cuenta"), "cuenta");
  assert.equal(parseProfileTab(undefined), "cuenta");
  assert.equal(parseProfileTab("otra"), "cuenta");
  assert.equal(parseProfileTab(["avisos"]), "cuenta");
});
