import assert from "node:assert/strict";
import { test } from "node:test";
import { buildTemplateApplication, summarizeTemplate, templateInputSchema } from "../src/lib/project-templates";
import { POSITION_STEP } from "../src/lib/positions";

const base = {
  name: "Web",
  description: "",
  columns: [
    { name: "Todo", role: "NONE" as const, isDone: false },
    { name: "Hecho", role: "IN_PRODUCTION" as const, isDone: true },
  ],
  kinds: [],
  hiddenGeneralKinds: [],
  labels: [],
};

test("valida plantillas correctas", () => {
  assert.equal(templateInputSchema.safeParse(base).success, true);
});

test("rechaza columnas repetidas, roles repetidos y sin columnas", () => {
  const dup = { ...base, columns: [base.columns[0], { ...base.columns[0], name: " todo " }] };
  assert.equal(templateInputSchema.safeParse(dup).success, false);
  const roles = { ...base, columns: [{ name: "A", role: "NEXT_RELEASE" as const, isDone: false }, { name: "B", role: "NEXT_RELEASE" as const, isDone: false }] };
  assert.equal(templateInputSchema.safeParse(roles).success, false);
  assert.equal(templateInputSchema.safeParse({ ...base, columns: [] }).success, false);
});

test("límites y colores", () => {
  const many = Array.from({ length: 21 }, (_, i) => ({ name: `C${i}`, role: "NONE" as const, isDone: false }));
  assert.equal(templateInputSchema.safeParse({ ...base, columns: many }).success, false);
  assert.equal(templateInputSchema.safeParse({ ...base, kinds: [{ name: "Bug", color: "rojo" }] }).success, false);
  assert.equal(templateInputSchema.safeParse({ ...base, kinds: [{ name: "Bug", color: "#FF0000" }] }).success, true);
  assert.equal(templateInputSchema.safeParse({ ...base, labels: [{ name: "x", color: "#123456" }] }).success, false);
});

test("resumen", () => {
  const t = templateInputSchema.parse({ ...base, hiddenGeneralKinds: ["Mejora"] });
  assert.equal(summarizeTemplate(t), "2 columnas · 0 tipos propios · 0 etiquetas · 1 general oculto");
});

test("aplicar plantilla: posiciones y tipos generales ocultos", () => {
  const t = templateInputSchema.parse({ ...base, kinds: [{ name: "Bug", color: "#ff0000" }], hiddenGeneralKinds: ["mejora", "No existe"] });
  const app = buildTemplateApplication(t, [{ id: "a", name: "Mejora" }, { id: "b", name: "Tarea" }]);
  assert.deepEqual(app.hiddenKindIds, ["a"]);
  assert.equal(app.columns[1]!.position, 2 * POSITION_STEP);
  assert.equal(app.kinds[0]!.position, POSITION_STEP);
});

test("nunca se ocultan todos los tipos si no hay propios", () => {
  const t = templateInputSchema.parse({ ...base, hiddenGeneralKinds: ["Mejora", "Tarea"] });
  const app = buildTemplateApplication(t, [{ id: "a", name: "Mejora" }, { id: "b", name: "Tarea" }]);
  assert.deepEqual(app.hiddenKindIds, ["b"]);
  const withOwn = templateInputSchema.parse({ ...base, kinds: [{ name: "Bug", color: "#ff0000" }], hiddenGeneralKinds: ["Mejora", "Tarea"] });
  assert.equal(buildTemplateApplication(withOwn, [{ id: "a", name: "Mejora" }, { id: "b", name: "Tarea" }]).hiddenKindIds.length, 2);
});

test("plantillas de release: por defecto vacías, topes por tipo y posiciones por tipo", () => {
  assert.deepEqual(templateInputSchema.parse(base).releaseTemplates, []);
  const mk = (kind: "HEADER" | "FOOTER", n: number) => Array.from({ length: n }, (_, i) => ({ kind, name: `R${i}`, content: "- [ ] x" }));
  assert.equal(templateInputSchema.safeParse({ ...base, releaseTemplates: [...mk("HEADER", 20), ...mk("FOOTER", 20)] }).success, true);
  assert.equal(templateInputSchema.safeParse({ ...base, releaseTemplates: mk("HEADER", 21) }).success, false);
  assert.equal(templateInputSchema.safeParse({ ...base, releaseTemplates: [{ kind: "OTRO", name: "x", content: "" }] }).success, false);
  const t = templateInputSchema.parse({ ...base, releaseTemplates: [{ kind: "FOOTER", name: "F1", content: "" }, { kind: "HEADER", name: "H1", content: "a" }, { kind: "HEADER", name: "H2", content: "b" }] });
  const app = buildTemplateApplication(t, []);
  assert.deepEqual(app.releaseTemplates.map((r) => [r.kind, r.name, r.position]), [["HEADER", "H1", POSITION_STEP], ["HEADER", "H2", 2 * POSITION_STEP], ["FOOTER", "F1", POSITION_STEP]]);
});
