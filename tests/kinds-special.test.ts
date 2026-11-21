import assert from "node:assert/strict";
import { test } from "node:test";
import { applyKindTemplate, describeKindAutomation, mergeSubtasks, parseSubtaskLines, switchKindDescription, switchKindSubtasks, switchKindText, switchKindTitle } from "../src/lib/kinds-special";

const RESPUESTA_LINE = "Respondo a las preguntas y lo que necesitas de mi:";

const RESP = { titleTemplate: "Respuesta", descriptionTemplate: RESPUESTA_LINE };

test("un tipo sin automatización no cambia nada", () => {
  assert.equal(applyKindTemplate({ titleTemplate: "", descriptionTemplate: "" }, { title: "x", description: "y" }), null);
  assert.equal(applyKindTemplate({ titleTemplate: "  ", descriptionTemplate: " " }, { title: "x", description: "y" }), null);
});

test("fija el título y antepone el texto", () => {
  assert.deepEqual(applyKindTemplate(RESP, { title: "Algo", description: "" }), { title: "Respuesta", description: `${RESPUESTA_LINE}\n` });
  assert.deepEqual(applyKindTemplate(RESP, { title: "Algo", description: "Texto previo" }), {
    title: "Respuesta",
    description: `${RESPUESTA_LINE}\nTexto previo`,
  });
});

test("no duplica el texto si ya está al principio", () => {
  const description = `  ${RESPUESTA_LINE}\n- punto`;
  assert.equal(applyKindTemplate(RESP, { title: "t", description })!.description, description);
});

test("solo título o solo descripción", () => {
  assert.deepEqual(applyKindTemplate({ titleTemplate: "Aviso", descriptionTemplate: "" }, { title: "t", description: "d" }), { title: "Aviso", description: "d" });
  assert.deepEqual(applyKindTemplate({ titleTemplate: "", descriptionTemplate: "Pasos:" }, { title: "t", description: "" }), { title: "t", description: "Pasos:\n" });
});

test("describeKindAutomation resume y trunca", () => {
  assert.equal(describeKindAutomation({ titleTemplate: "", descriptionTemplate: "" }), null);
  assert.equal(describeKindAutomation({ titleTemplate: "Aviso", descriptionTemplate: "" }), "Al elegirlo, el título pasa a ser «Aviso».");
  assert.equal(describeKindAutomation({ titleTemplate: "", descriptionTemplate: "Pasos:" }), "Al elegirlo, la descripción empieza por «Pasos:».");
  const line = describeKindAutomation(RESP)!;
  assert.ok(line.includes("«Respuesta»") && line.includes("«Respondo a las preguntas y lo que necesitas de mi:»"));
  assert.ok(describeKindAutomation({ titleTemplate: "", descriptionTemplate: "a".repeat(100) })!.includes("…"));
});

test("subtareas predefinidas: una por línea, sin vacías ni repetidas", () => {
  assert.deepEqual(parseSubtaskLines("Revisar\n\n  Probar  \r\nrevisar\nDesplegar"), ["Revisar", "Probar", "Desplegar"]);
  assert.deepEqual(parseSubtaskLines(""), []);
  assert.equal(parseSubtaskLines(Array.from({ length: 80 }, (_, i) => `paso ${i}`).join("\n")).length, 50);
});

test("al elegir el tipo se añaden las subtareas que faltan", () => {
  assert.deepEqual(mergeSubtasks([], ["A", "B"]), ["A", "B"]);
  assert.deepEqual(mergeSubtasks(["b", "Extra"], ["A", "B"]), ["b", "Extra", "A"]);
  // Elegir el mismo tipo dos veces no duplica.
  assert.deepEqual(mergeSubtasks(mergeSubtasks([], ["A", "B"]), ["A", "B"]), ["A", "B"]);
  assert.equal(mergeSubtasks(Array.from({ length: 49 }, (_, i) => `x${i}`), ["n1", "n2"]).length, 50);
});

// --- Cambiar de tipo con la plantilla del anterior puesta (plantilla «Reformas y obras») ---
const PRESU = {
  titleTemplate: "Presupuesto:",
  descriptionTemplate: "**Empresa o profesional:** [nombre]\n\n**Alcance incluido:**\n",
  subtaskTemplate: ["Pedir presupuesto", "Comparar con otros", "Aceptar o rechazar"],
};
const PERMISO = {
  titleTemplate: "Permiso:",
  descriptionTemplate: "**Trámite:**\n\n**Organismo:**\n",
  subtaskTemplate: ["Reunir la documentación", "Presentar la solicitud", "Guardar la resolución"],
};
const PLAIN = { titleTemplate: "", descriptionTemplate: "", subtaskTemplate: [] };

test("sin tipo anterior, igual que aplicar la plantilla (lo que hace «Nueva tarea» al abrir)", () => {
  assert.deepEqual(switchKindText(null, PRESU, { title: "", description: "", subtasks: [] }), {
    title: "Presupuesto:",
    description: `${PRESU.descriptionTemplate.trim()}\n`,
    subtasks: PRESU.subtaskTemplate,
  });
  assert.deepEqual(switchKindText(null, PLAIN, { title: "x", description: "y", subtasks: ["a"] }), { title: "x", description: "y", subtasks: ["a"] });
});

test("sin tocar lo que puso el tipo anterior: se sustituye por lo del nuevo, sin acumular", () => {
  const first = switchKindText(null, PERMISO, { title: "", description: "", subtasks: [] });
  const second = switchKindText(PERMISO, PRESU, first);
  assert.deepEqual(second, switchKindText(null, PRESU, { title: "", description: "", subtasks: [] }));
  assert.ok(!second.description.includes("Trámite"));
  assert.equal(second.subtasks.length, 3);
  // A un tipo sin plantilla: queda vacío.
  assert.deepEqual(switchKindText(PRESU, PLAIN, second), { title: "", description: "", subtasks: [] });
});

test("el título: se cambia el prefijo y se conserva lo escrito detrás", () => {
  assert.equal(switchKindTitle(PRESU, PERMISO, "Presupuesto: fontanería"), "Permiso: fontanería");
  assert.equal(switchKindTitle(PRESU, PERMISO, "Presupuesto:"), "Permiso:");
  // Un título que ya no empieza por el prefijo: como siempre, el título fijo del tipo nuevo.
  assert.equal(switchKindTitle(PRESU, PERMISO, "Fontanería"), "Permiso:");
  // A un tipo sin prefijo: solo se quita el prefijo sin nada detrás.
  assert.equal(switchKindTitle(PRESU, PLAIN, "Presupuesto:"), "");
  assert.equal(switchKindTitle(RESP, PLAIN, "Respuesta a Juan"), "Respuesta a Juan");
  // «Comprar» no es prefijo de «Comprarlo todo».
  assert.equal(switchKindTitle({ titleTemplate: "Comprar", descriptionTemplate: "" }, { titleTemplate: "Gestionar", descriptionTemplate: "" }, "Comprarlo todo"), "Gestionar");
  assert.equal(switchKindTitle({ titleTemplate: "Comprar", descriptionTemplate: "" }, { titleTemplate: "Gestionar", descriptionTemplate: "" }, "Comprar pan"), "Gestionar pan");
  // El mismo tipo otra vez (pulsar el ya elegido) no cambia nada, aunque se haya borrado el prefijo.
  assert.equal(switchKindTitle(PRESU, PRESU, "Presupuesto: fontanería"), "Presupuesto: fontanería");
  assert.equal(switchKindTitle(PRESU, PRESU, "Fontanería"), "Fontanería");
});

test("la descripción: la plantilla anterior sin tocar se cambia y lo escrito debajo se conserva", () => {
  const tpl = PRESU.descriptionTemplate.trim();
  assert.equal(switchKindDescription(PRESU, PERMISO, `${tpl}\nNotas mías`), `${PERMISO.descriptionTemplate.trim()}\nNotas mías`);
  assert.equal(switchKindDescription(PRESU, PLAIN, `${tpl}\n`), "");
  // Rellenada (el formulario ha cambiado): se conserva y se añade el texto del nuevo al principio, sin duplicarlo.
  const filled = tpl.replace("[nombre]", "Reformas López");
  const out = switchKindDescription(PRESU, PERMISO, filled);
  assert.equal(out, `${PERMISO.descriptionTemplate.trim()}\n${filled}`);
  assert.equal(switchKindDescription(PRESU, PERMISO, out), out);
  // Escrito en la misma línea que el final de la plantilla: también cuenta como cambiado.
  assert.equal(switchKindDescription(PRESU, PLAIN, `${tpl} todo el baño`), `${tpl} todo el baño`);
  // El mismo tipo otra vez no duplica (tampoco el formulario ya rellenado).
  assert.equal(switchKindDescription(PRESU, PRESU, `${tpl}\n`), `${tpl}\n`);
  assert.equal(switchKindDescription(PRESU, PRESU, filled), filled);
});

test("las subtareas: las del anterior se cambian si siguen todas; si se ha quitado alguna, se conservan", () => {
  // Con una suya añadida: se queda la suya y se cambian las del tipo.
  assert.deepEqual(switchKindSubtasks(PRESU, PERMISO, ["Mía", ...PRESU.subtaskTemplate]), ["Mía", ...PERMISO.subtaskTemplate]);
  // Quitada una del tipo (editada): se conservan las que hay y se añaden las del nuevo sin repetir.
  assert.deepEqual(switchKindSubtasks(PRESU, PERMISO, ["Pedir presupuesto"]), ["Pedir presupuesto", ...PERMISO.subtaskTemplate]);
  // Sin distinguir mayúsculas.
  assert.deepEqual(switchKindSubtasks(PRESU, PLAIN, ["pedir presupuesto", "COMPARAR CON OTROS", "Aceptar o rechazar"]), []);
  // El mismo tipo: la lista no se toca (lo quitado no vuelve).
  assert.deepEqual(switchKindSubtasks(PRESU, PRESU, ["Comparar con otros", "Mía"]), ["Comparar con otros", "Mía"]);
  assert.deepEqual(switchKindSubtasks(PRESU, PRESU, [...PRESU.subtaskTemplate, "Mía"]), [...PRESU.subtaskTemplate, "Mía"]);
});
