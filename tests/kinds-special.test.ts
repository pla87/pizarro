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
    description: `${RESPUESTA_LINE}\n\nTexto previo`,
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
  assert.equal(describeKindAutomation({ titleTemplate: "Aviso", descriptionTemplate: "" }), "Al elegirlo, el título empieza por «Aviso».");
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
    title: "Presupuesto: ",
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
  // Solo el prefijo: el nuevo, con un espacio detrás para seguir escribiendo.
  assert.equal(switchKindTitle(PRESU, PERMISO, "Presupuesto:"), "Permiso: ");
  // Un título que no empieza por el prefijo del anterior: lo escrito se conserva y el prefijo del nuevo va delante.
  assert.equal(switchKindTitle(PRESU, PERMISO, "Fontanería"), "Permiso: Fontanería");
  // A un tipo sin prefijo: solo se quita el prefijo sin nada detrás.
  assert.equal(switchKindTitle(PRESU, PLAIN, "Presupuesto:"), "");
  assert.equal(switchKindTitle(RESP, PLAIN, "Respuesta a Juan"), "Respuesta a Juan");
  // «Comprar» no es prefijo de «Comprarlo todo».
  assert.equal(switchKindTitle({ titleTemplate: "Comprar", descriptionTemplate: "" }, { titleTemplate: "Gestionar", descriptionTemplate: "" }, "Comprarlo todo"), "Gestionar Comprarlo todo");
  assert.equal(switchKindTitle({ titleTemplate: "Comprar", descriptionTemplate: "" }, { titleTemplate: "Gestionar", descriptionTemplate: "" }, "Comprar pan"), "Gestionar pan");
  // El mismo tipo otra vez (pulsar el ya elegido) no cambia nada, aunque se haya borrado el prefijo.
  assert.equal(switchKindTitle(PRESU, PRESU, "Presupuesto: fontanería"), "Presupuesto: fontanería");
  assert.equal(switchKindTitle(PRESU, PRESU, "Fontanería"), "Fontanería");
});

test("el título escrito no se pierde nunca al elegir un tipo con prefijo", () => {
  // Plantilla «Hogar»: Salud «Cita: », Casa sin prefijo, Compras «Comprar ».
  const SALUD = { titleTemplate: "Cita: ", descriptionTemplate: "" };
  const CASA = { titleTemplate: "", descriptionTemplate: "" };
  const COMPRAS = { titleTemplate: "Comprar ", descriptionTemplate: "" };
  assert.equal(switchKindTitle(CASA, COMPRAS, "Leche y pan"), "Comprar Leche y pan");
  assert.equal(switchKindTitle(null, COMPRAS, "  Leche y pan "), "Comprar Leche y pan");
  assert.equal(switchKindTitle(CASA, SALUD, "dentista"), "Cita: dentista");
  // Salud → Casa → Compras: «dentista» sigue ahí.
  assert.equal(switchKindTitle(CASA, COMPRAS, switchKindTitle(SALUD, CASA, "Cita: dentista")), "Comprar Cita: dentista");
  // Si ya empieza por el prefijo del nuevo, no se duplica.
  assert.equal(switchKindTitle(CASA, COMPRAS, "Comprar pan"), "Comprar pan");
  // Vacío: el prefijo con su espacio, para escribir detrás y que se siga reconociendo al cambiar otra vez de tipo.
  const empty = switchKindTitle(null, COMPRAS, "");
  assert.equal(empty, "Comprar ");
  assert.equal(switchKindTitle(COMPRAS, SALUD, `${empty}pan`), "Cita: pan");
  assert.equal(switchKindTitle(COMPRAS, SALUD, empty), "Cita: ");
  // Un prefijo guardado sin espacio (los tipos creados a mano se guardan recortados) también lleva el espacio.
  assert.equal(switchKindTitle(null, { titleTemplate: "Comprar", descriptionTemplate: "" }, ""), "Comprar ");
  // A un tipo sin prefijo, el título escrito se queda tal cual.
  assert.equal(switchKindTitle(COMPRAS, CASA, "Leche y pan"), "Leche y pan");
});

test("la descripción: la plantilla anterior sin tocar se cambia y lo escrito debajo se conserva", () => {
  const tpl = PRESU.descriptionTemplate.trim();
  assert.equal(switchKindDescription(PRESU, PERMISO, `${tpl}\n\nNotas mías`), `${PERMISO.descriptionTemplate.trim()}\n\nNotas mías`);
  assert.equal(switchKindDescription(PRESU, PLAIN, `${tpl}\n`), "");
  // Rellenada (el formulario ha cambiado): se conserva y se añade el texto del nuevo al principio, sin duplicarlo.
  const filled = tpl.replace("[nombre]", "Reformas López");
  const out = switchKindDescription(PRESU, PERMISO, filled);
  assert.equal(out, `${PERMISO.descriptionTemplate.trim()}\n\n${filled}`);
  assert.equal(switchKindDescription(PRESU, PERMISO, out), out);
  // Escrito en la misma línea que el final de la plantilla: también cuenta como cambiado.
  assert.equal(switchKindDescription(PRESU, PLAIN, `${tpl} todo el baño`), `${tpl} todo el baño`);
  // El mismo tipo otra vez no duplica (tampoco el formulario ya rellenado).
  assert.equal(switchKindDescription(PRESU, PRESU, `${tpl}\n`), `${tpl}\n`);
  assert.equal(switchKindDescription(PRESU, PRESU, filled), filled);
});

test("la descripción: la respuesta escrita en la última línea del formulario no pierde su etiqueta", () => {
  const SALUD = { titleTemplate: "Cita: ", descriptionTemplate: "**Quién:**\n\n**Dónde y cuándo:**\n\n**Preguntas para la consulta:**\n" };
  const CASA = { titleTemplate: "", descriptionTemplate: "**Qué hay que hacer:**\n\n**Material necesario:**\n" };
  // Elegir Salud deja el cursor en la línea vacía final; se escribe ahí la respuesta a la última pregunta.
  const answered = `${switchKindDescription(null, SALUD, "")}Llevar análisis`;
  const out = switchKindDescription(SALUD, CASA, answered);
  assert.ok(out.includes("**Preguntas para la consulta:**\nLlevar análisis"), out);
  // El formulario nuevo va encima, separado por una línea en blanco: la respuesta no queda bajo «Material necesario».
  assert.equal(out, `${CASA.descriptionTemplate.trim()}\n\n${answered}`);
  // Lo que ya había al elegir el tipo (compartido, enlazado) va tras una línea en blanco y se sigue cambiando de formulario.
  const shared = switchKindDescription(null, SALUD, "Texto compartido");
  assert.equal(shared, `${SALUD.descriptionTemplate.trim()}\n\nTexto compartido`);
  assert.equal(switchKindDescription(SALUD, CASA, shared), `${CASA.descriptionTemplate.trim()}\n\nTexto compartido`);
  // Una línea en blanco con espacios también separa.
  assert.equal(switchKindDescription(SALUD, CASA, `${SALUD.descriptionTemplate.trim()}\n  \nMías`), `${CASA.descriptionTemplate.trim()}\n\nMías`);
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
