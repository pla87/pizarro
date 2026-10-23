import assert from "node:assert/strict";
import { test } from "node:test";
import { BUILTIN_KEYS, BUILTIN_TEMPLATES, canonicalTemplate, isBuiltinModified } from "../src/lib/builtin-templates";
import { buildTemplateApplication, sortTemplates, templateInputSchema } from "../src/lib/project-templates";

test("cada plantilla de serie pasa la misma validación que las de los usuarios", () => {
  assert.equal(BUILTIN_TEMPLATES.length, 6);
  for (const b of BUILTIN_TEMPLATES) {
    const r = templateInputSchema.safeParse(b.data);
    assert.equal(r.success, true, `${b.key}: ${r.success ? "" : r.error.message}`);
  }
});

test("claves y nombres únicos; textos dentro de los límites de los tipos", () => {
  assert.equal(new Set(BUILTIN_KEYS).size, BUILTIN_KEYS.length);
  assert.equal(new Set(BUILTIN_TEMPLATES.map((b) => b.data.name.toLowerCase())).size, BUILTIN_TEMPLATES.length);
  for (const b of BUILTIN_TEMPLATES) {
    const t = canonicalTemplate(b.key)!;
    for (const k of t.kinds) assert.ok(k.descriptionTemplate.length <= 2000, `${b.key}/${k.name}`);
    assert.ok(t.columns.some((c) => c.isDone), `${b.key} sin columna de terminadas`);
  }
});

test("aplicar una plantilla de serie no pierde tipos ni subtareas", () => {
  const t = canonicalTemplate("produccion-audiovisual")!;
  const app = buildTemplateApplication(t, [{ id: "1", name: "Funcionalidad" }, { id: "2", name: "Corrección" }, { id: "3", name: "Respuesta" }]);
  assert.equal(app.kinds.length, t.kinds.length);
  assert.deepEqual(app.kinds[1]!.subtaskTemplate, t.kinds[1]!.subtaskTemplate);
  assert.deepEqual(app.hiddenKindIds, ["1", "2"]);
});

test("vibecoding tiene los roles de release", () => {
  const roles = canonicalTemplate("vibecoding")!.columns.map((c) => c.role);
  assert.ok(roles.includes("NEXT_RELEASE") && roles.includes("IN_PRODUCTION"));
});

test("isBuiltinModified: igual, editada, sin clave y clave desconocida", () => {
  const canon = canonicalTemplate("negocio")!;
  assert.equal(isBuiltinModified(canon, "negocio"), false);
  // Lo que llega de la base de datos pasa por el mismo esquema: sigue sin estar modificada.
  assert.equal(isBuiltinModified(templateInputSchema.parse(JSON.parse(JSON.stringify(canon))), "negocio"), false);
  assert.equal(isBuiltinModified({ ...canon, name: "Mi negocio" }, "negocio"), true);
  assert.equal(isBuiltinModified({ ...canon, columns: [...canon.columns].reverse() }, "negocio"), true);
  assert.equal(isBuiltinModified({ ...canon, labels: canon.labels.slice(1) }, "negocio"), true);
  assert.equal(isBuiltinModified({ ...canon, kinds: canon.kinds.map((k, i) => (i === 0 ? { ...k, subtaskTemplate: [] } : k)) }, "negocio"), true);
  assert.equal(isBuiltinModified({ ...canon, name: "otro" }, null), false);
  assert.equal(isBuiltinModified({ ...canon, name: "otro" }, "desconocida"), false);
});

test("sortTemplates ordena en español sin distinguir mayúsculas ni tildes", () => {
  const names = sortTemplates([{ name: "Vibecoding" }, { name: "Éxito" }, { name: "ñu" }, { name: "negocio" }, { name: "Eventos" }, { name: "Zeta" }]).map((x) => x.name);
  assert.deepEqual(names, ["Eventos", "Éxito", "negocio", "ñu", "Vibecoding", "Zeta"]);
});
