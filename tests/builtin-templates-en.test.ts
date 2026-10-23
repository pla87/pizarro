import assert from "node:assert/strict";
import { test } from "node:test";
import { BUILTIN_KEYS, BUILTIN_TEMPLATES, canonicalTemplate } from "../src/lib/builtin-templates";
import { BUILTIN_TEMPLATES_EN, canonicalTemplateEn, localizeTemplate } from "../src/lib/builtin-templates-en";
import { buildTemplateApplication, sortTemplates } from "../src/lib/project-templates";

test("cada plantilla de serie tiene versión inglesa con la misma estructura", () => {
  assert.deepEqual(Object.keys(BUILTIN_TEMPLATES_EN).sort(), [...BUILTIN_KEYS].sort());
  for (const key of BUILTIN_KEYS) {
    const es = canonicalTemplate(key)!;
    const en = canonicalTemplateEn(key)!;
    assert.equal(en.columns.length, es.columns.length, `${key}: columnas`);
    en.columns.forEach((c, i) => {
      assert.equal(c.role, es.columns[i]!.role, `${key}: rol de columna ${i}`);
      assert.equal(c.isDone, es.columns[i]!.isDone, `${key}: terminada ${i}`);
    });
    assert.equal(en.kinds.length, es.kinds.length, `${key}: tipos`);
    en.kinds.forEach((k, i) => {
      const e = es.kinds[i]!;
      assert.equal(k.color, e.color, `${key}/${k.name}: color`);
      assert.equal(k.subtaskTemplate.length, e.subtaskTemplate.length, `${key}/${k.name}: subtareas`);
      assert.equal(k.titleTemplate === "", e.titleTemplate === "", `${key}/${k.name}: prefijo de título`);
      assert.equal(k.descriptionTemplate.split("\n").length, e.descriptionTemplate.split("\n").length, `${key}/${k.name}: líneas de la descripción`);
      assert.equal((k.descriptionTemplate.match(/\*\*/g) ?? []).length, (e.descriptionTemplate.match(/\*\*/g) ?? []).length, `${key}/${k.name}: negritas`);
    });
    assert.deepEqual(en.labels.map((l) => l.color), es.labels.map((l) => l.color), `${key}: colores de etiquetas`);
    assert.deepEqual(en.hiddenGeneralKinds, es.hiddenGeneralKinds, `${key}: generales ocultos`);
    assert.equal(en.hideAllGeneralKinds, es.hideAllGeneralKinds, `${key}: ocultar todos`);
  }
});

test("la versión inglesa no deja restos de español en los campos de texto", () => {
  const spanish = /[áéíóúñ¿¡]|\b(el|la|los|las|de|del|para|con|sin|una?|que|por|y)\b/i;
  const texts = (key: string) => {
    const t = canonicalTemplateEn(key)!;
    return [
      t.name,
      t.description,
      ...t.columns.map((c) => c.name),
      ...t.kinds.flatMap((k) => [k.name, k.titleTemplate, k.descriptionTemplate, ...k.subtaskTemplate]),
      ...t.labels.map((l) => l.name),
    ];
  };
  for (const key of BUILTIN_KEYS) {
    for (const s of texts(key)) assert.ok(!spanish.test(s), `${key}: «${s}» parece español`);
  }
  // Y ningún texto coincide con el español salvo nombres propios idénticos (Backlog, Blog…).
  const same = new Set(["Backlog", "Ideas", "Vibecoding", "Frontend", "Backend", "Blog", "Instagram", "LinkedIn", "Newsletter", "Evergreen", "Idea", "Marketing"]);
  for (const key of BUILTIN_KEYS) {
    const es = canonicalTemplate(key)!;
    const en = canonicalTemplateEn(key)!;
    assert.notEqual(en.name === es.name && !same.has(en.name), true, `${key}: nombre sin traducir`);
    assert.notEqual(en.description, es.description);
    en.kinds.forEach((k, i) => assert.notEqual(k.descriptionTemplate, es.kinds[i]!.descriptionTemplate, `${key}/${k.name}`));
    en.columns.forEach((c, i) => assert.ok(c.name !== es.columns[i]!.name || same.has(c.name), `${key}: columna «${c.name}» sin traducir`));
  }
});

test("localizeTemplate: de serie sin tocar y en inglés → datos ingleses; modificada, propia o español → lo guardado", () => {
  const key = "mudanza";
  const stored = { id: "x", ...canonicalTemplate(key)! };
  const en = localizeTemplate(stored, key, "en");
  assert.equal(en.id, "x");
  assert.equal(en.name, "House move");
  assert.equal(en.columns[0]!.name, "To do");
  assert.equal(en.kinds[0]!.name, "Admin and change of address");

  assert.equal(localizeTemplate(stored, key, "es"), stored);
  assert.equal(localizeTemplate(stored, null, "en"), stored);
  assert.equal(localizeTemplate(stored, "no-existe", "en").name, stored.name);

  const edited = { ...stored, name: "Mi mudanza" };
  assert.equal(localizeTemplate(edited, key, "en"), edited);
  const editedCol = { ...stored, columns: [...stored.columns, { name: "Extra", role: "NONE" as const, isDone: false }] };
  assert.equal(localizeTemplate(editedCol, key, "en"), editedCol);
});

test("aplicar la versión inglesa crea columnas, tipos y etiquetas en inglés y oculta los generales (nombres españoles)", () => {
  const generals = [{ id: "1", name: "Funcionalidad" }, { id: "2", name: "Corrección" }, { id: "3", name: "Respuesta" }];
  for (const b of BUILTIN_TEMPLATES) {
    const stored = { id: "x", ...canonicalTemplate(b.key)! };
    const es = buildTemplateApplication(stored, generals);
    const en = buildTemplateApplication(localizeTemplate(stored, b.key, "en"), generals, "en");
    assert.equal(en.kinds.length, es.kinds.length, b.key);
    assert.equal(en.columns.length, es.columns.length, b.key);
    assert.deepEqual(en.hiddenKindIds, es.hiddenKindIds, b.key);
  }
});

test("el orden alfabético sigue el idioma", () => {
  const names = [{ name: "Étude" }, { name: "Zebra" }, { name: "Apple" }];
  assert.deepEqual(sortTemplates(names, "en").map((n) => n.name), ["Apple", "Étude", "Zebra"]);
});
