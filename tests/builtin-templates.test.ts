import assert from "node:assert/strict";
import { test } from "node:test";
import { BUILTIN_KEYS, BUILTIN_TEMPLATES, canonicalTemplate, isBuiltinModified } from "../src/lib/builtin-templates";
import { buildTemplateApplication, sortTemplates, templateInputSchema } from "../src/lib/project-templates";

test("cada plantilla de serie pasa la misma validación que las de los usuarios", () => {
  assert.equal(BUILTIN_TEMPLATES.length, 12);
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
  // Plantilla ajena al software: se ocultan todos los generales, también Respuesta.
  assert.deepEqual(app.hiddenKindIds, ["1", "2", "3"]);
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

test("solo Vibecoding conserva los tipos generales; el resto los oculta todos y trae sus propios tipos", () => {
  for (const b of BUILTIN_TEMPLATES) {
    const t = canonicalTemplate(b.key)!;
    assert.equal(t.hideAllGeneralKinds, b.key !== "vibecoding", b.key);
    if (b.key !== "vibecoding") assert.ok(t.kinds.length >= 4, b.key);
  }
});

test("las seis plantillas nuevas existen, con subtareas y etiquetas válidas", () => {
  for (const key of ["soporte-clientes", "seleccion-personal", "reformas-obras", "viajes", "estudios-tesis", "mudanza"]) {
    const t = canonicalTemplate(key);
    assert.ok(t, key);
    assert.ok(t.kinds.some((k) => k.subtaskTemplate.length > 0), `${key} sin subtareas`);
    assert.ok(t.kinds.every((k) => k.descriptionTemplate.length > 0), `${key} con tipo sin descripción`);
    assert.ok(t.labels.length >= 4, key);
    assert.equal(t.hideAllGeneralKinds, true);
  }
});

test("hideAllGeneralKinds oculta todos los generales aunque no estén en la lista", () => {
  const general = [{ id: "1", name: "Funcionalidad" }, { id: "2", name: "Mejora" }, { id: "3", name: "Respuesta" }];
  const base = canonicalTemplate("negocio")!;
  const all = buildTemplateApplication({ ...base, hiddenGeneralKinds: [] }, general);
  assert.deepEqual(all.hiddenKindIds, ["1", "2", "3"]);
  // Sin la opción solo se ocultan los listados.
  assert.deepEqual(buildTemplateApplication({ ...base, hideAllGeneralKinds: false, hiddenGeneralKinds: ["mejora"] }, general).hiddenKindIds, ["2"]);
  // Sin tipos propios se deja uno visible.
  const sinPropios = buildTemplateApplication({ ...base, kinds: [] }, general);
  assert.deepEqual(sinPropios.hiddenKindIds, ["2", "3"]);
});

test("el esquema acepta plantillas antiguas sin la opción (falso) y rechaza valores no booleanos", () => {
  const { hideAllGeneralKinds: _omit, ...old } = canonicalTemplate("negocio")!;
  assert.equal(templateInputSchema.parse(old).hideAllGeneralKinds, false);
  assert.equal(templateInputSchema.safeParse({ ...old, hideAllGeneralKinds: "si" }).success, false);
});
