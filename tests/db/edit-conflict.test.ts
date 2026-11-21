// «Otra persona ha cambiado esto mientras lo editabas»: plantillas de proyecto, textos legales y ajustes de
// Administración no pisan lo que otro administrador guardó después de abrir el formulario (edit-conflict.ts).
import assert from "node:assert/strict";
import { afterEach, describe, test } from "node:test";
import { db, expectOk, loginAs, makeUser } from "./helpers";
import { saveLegalIdentity, saveLegalPage } from "../../src/actions/legal";
import { saveInstallationSettings, saveMaxCommentsPerTask } from "../../src/actions/settings";
import { saveStorageQuotas } from "../../src/actions/storage";
import { resetTemplate, saveTemplate } from "../../src/actions/templates";
import { listTemplatesSorted } from "../../src/lib/template-store";
import { getLegalSettings } from "../../src/lib/legal";
import { invalidateInstance } from "../../src/lib/instance";
import { invalidateAppSettings } from "../../src/lib/app-settings";
import { settingsVersions } from "../../src/lib/settings-versions";
import { editVersion, EDIT_CONFLICT_CODE } from "../../src/lib/edit-conflict-core";

const SETTING_KEYS = ["google.publicContactEmail", "maxCommentsPerTask", "uploadQuotaMbPerProject", "uploadQuotaMbTotal"];

afterEach(async () => {
  await db.appState.deleteMany({ where: { OR: [{ key: { startsWith: "legal." } }, { key: { startsWith: "instance." } }, { key: { in: SETTING_KEYS } }] } });
  invalidateInstance();
  invalidateAppSettings();
});

/** Falla por conflicto: con su código y el texto del aviso (sin guardar nada). */
function expectConflict(res: { ok: boolean; error?: string; code?: string }) {
  assert.equal(res.ok, false, JSON.stringify(res));
  assert.equal(res.code, EDIT_CONFLICT_CODE);
  assert.equal(res.error, "Otra persona ha cambiado esto mientras lo editabas.");
}

describe("versión de lo guardado", () => {
  test("misma forma, misma huella; cualquier cambio de valor, otra", () => {
    assert.equal(editVersion(["a", null]), editVersion(["a", null]));
    assert.notEqual(editVersion(["a", null]), editVersion(["b", null]));
    assert.notEqual(editVersion(["a", null]), editVersion([null, "a"]));
  });
});

describe("textos legales", () => {
  test("dos administradores con la página abierta: el segundo en guardar recibe el aviso y no pisa nada", async () => {
    await loginAs(await makeUser({ role: "ADMIN" }));
    const opened = (await getLegalSettings()).versions;
    const first = expectOk(await saveLegalPage({ kind: "privacy", es: "Texto de Ana", en: "", since: opened.privacy }));
    expectConflict(await saveLegalPage({ kind: "privacy", es: "Texto de Luis", en: "", since: opened.privacy }));
    assert.equal((await getLegalSettings()).texts.privacy.es, "Texto de Ana");
    // La otra página no ha cambiado: se guarda.
    expectOk(await saveLegalPage({ kind: "terms", es: "Condiciones", en: "", since: opened.terms }));
    // Con la versión que devolvió su guardado, la misma persona sigue guardando sin aviso.
    expectOk(await saveLegalPage({ kind: "privacy", es: "Texto de Ana 2", en: "", since: first.version }));
    // Responsable y contacto.
    const id = expectOk(await saveLegalIdentity({ responsible: "Ejemplo S.L.", email: "", since: opened.contact }));
    expectConflict(await saveLegalIdentity({ responsible: "Otra S.L.", email: "", since: opened.contact }));
    expectOk(await saveLegalIdentity({ responsible: "Otra S.L.", email: "contacto@example.com", since: id.version }));
    // Sin versión (una pestaña de antes de este cambio), como antes: guarda.
    expectOk(await saveLegalPage({ kind: "privacy", es: "Sin versión", en: "" }));
  });

  test("guardar lo mismo que ya había (vacío) no cuenta como cambio", async () => {
    await loginAs(await makeUser({ role: "ADMIN" }));
    const opened = (await getLegalSettings()).versions.contact;
    expectOk(await saveLegalIdentity({ responsible: "", email: "" }));
    expectOk(await saveLegalIdentity({ responsible: "Ejemplo", email: "", since: opened }));
  });
});

describe("ajustes de Administración", () => {
  test("instalación, comentarios por tarea y cuotas", async () => {
    await loginAs(await makeUser({ role: "ADMIN" }));
    const opened = await settingsVersions();
    const inst = expectOk(await saveInstallationSettings({ orgName: "Acme", locale: "es", timeZone: "Europe/Madrid", since: opened.installation }));
    expectConflict(await saveInstallationSettings({ orgName: "Otra", locale: "en", timeZone: "UTC", since: opened.installation }));
    assert.equal((await db.appState.findUnique({ where: { key: "instance.orgName" } }))?.value, "Acme");
    expectOk(await saveInstallationSettings({ orgName: "Acme 2", locale: "es", timeZone: "Europe/Madrid", since: inst.version }));
    assert.notEqual((await settingsVersions()).installation, opened.installation);

    const c = expectOk(await saveMaxCommentsPerTask(20, opened.comments));
    expectConflict(await saveMaxCommentsPerTask(30, opened.comments));
    assert.equal((await db.appState.findUnique({ where: { key: "maxCommentsPerTask" } }))?.value, "20");
    expectOk(await saveMaxCommentsPerTask(30, c.version));

    const q = expectOk(await saveStorageQuotas({ project: { mode: "custom", mb: 100 }, total: { mode: "default" } }, opened.storage));
    expectConflict(await saveStorageQuotas({ project: { mode: "custom", mb: 200 }, total: { mode: "default" } }, opened.storage));
    expectOk(await saveStorageQuotas({ project: { mode: "default" }, total: { mode: "default" } }, q.version));
  });
});

describe("plantillas de proyecto", () => {
  test("editar una plantilla que otro administrador guardó o restableció después: aviso y sin cambios", async () => {
    await loginAs(await makeUser({ role: "ADMIN" }));
    const created = expectOk(await saveTemplate({ name: `Conflicto ${Date.now()}`, description: "", columns: [{ name: "Hacer", role: "NONE", isDone: false }], kinds: [], hiddenGeneralKinds: [], labels: [] }));
    try {
      const opened = (await listTemplatesSorted(db)).find((t) => t.id === created.id)!;
      assert.ok(opened.version);
      const first = expectOk(await saveTemplate({ ...opened, description: "De Ana" }, opened.id, opened.version));
      assert.ok(first.version && first.version !== opened.version);
      expectConflict(await saveTemplate({ ...opened, description: "De Luis" }, opened.id, opened.version));
      assert.equal((await db.projectTemplate.findUniqueOrThrow({ where: { id: opened.id } })).description, "De Ana");
      expectOk(await saveTemplate({ ...opened, description: "De Ana 2" }, opened.id, first.version));
      // Sin versión, como antes; una versión que no es una fecha no se acepta.
      expectOk(await saveTemplate({ ...opened, description: "Sin versión" }, opened.id));
      assert.equal((await saveTemplate({ ...opened }, opened.id, "no-es-fecha")).ok, false);
    } finally {
      await db.projectTemplate.deleteMany({ where: { id: created.id } });
    }
    // Una de serie restablecida por otra persona también cuenta.
    const builtin = (await listTemplatesSorted(db)).find((t) => t.builtinKey);
    if (builtin) {
      expectOk(await resetTemplate(builtin.id));
      const fresh = (await listTemplatesSorted(db)).find((t) => t.id === builtin.id)!;
      expectOk(await saveTemplate({ ...fresh, name: "Cambiada" }, fresh.id, fresh.version));
      expectOk(await resetTemplate(builtin.id));
      expectConflict(await saveTemplate({ ...fresh, name: "Cambiada otra vez" }, fresh.id, fresh.version));
      expectOk(await resetTemplate(builtin.id));
    }
  });
});
