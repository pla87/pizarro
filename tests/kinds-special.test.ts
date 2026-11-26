import assert from "node:assert/strict";
import { test } from "node:test";
import { describeKindAutomation, kindChangeNotice, kindDescriptionChange, parseSubtaskLines, switchKindDescription, switchKindSubtaskRows, switchKindSubtasks, switchKindText, switchKindTitle, titleWithoutKindPrefix } from "../src/lib/kinds-special";

const RESPUESTA_LINE = "Respondo a las preguntas y lo que necesitas de mí:";

const RESP = { titleTemplate: "Respuesta", descriptionTemplate: RESPUESTA_LINE };

// Al elegir un tipo sin otro anterior (switchKind* con `prev` null) se aplica su automatización tal cual.
test("un tipo sin automatización no cambia nada", () => {
  for (const kind of [{ titleTemplate: "", descriptionTemplate: "" }, { titleTemplate: "  ", descriptionTemplate: " " }]) {
    assert.equal(switchKindDescription(null, kind, "y"), "y");
    assert.equal(switchKindDescription(null, kind, ""), "");
    assert.equal(switchKindTitle(null, kind, "x"), "x");
  }
});

test("pone el título del tipo y antepone el texto", () => {
  assert.equal(switchKindTitle(null, RESP, "Algo"), "Respuesta Algo");
  assert.equal(switchKindTitle(null, RESP, ""), "Respuesta ");
  assert.equal(switchKindDescription(null, RESP, ""), `${RESPUESTA_LINE}\n`);
  assert.equal(switchKindDescription(null, RESP, "   "), `${RESPUESTA_LINE}\n`);
  assert.equal(switchKindDescription(null, RESP, "Texto previo"), `${RESPUESTA_LINE}\n\nTexto previo`);
});

test("no duplica el texto si ya está al principio", () => {
  const description = `  ${RESPUESTA_LINE}\n- punto`;
  assert.equal(switchKindDescription(null, RESP, description), description);
});

test("solo título o solo descripción", () => {
  const AVISO = { titleTemplate: "Aviso", descriptionTemplate: "" };
  const PASOS = { titleTemplate: "", descriptionTemplate: "Pasos:" };
  assert.deepEqual(switchKindText(null, { ...AVISO, subtaskTemplate: [] }, { title: "t", description: "d", subtasks: [] }), { title: "Aviso t", description: "d", subtasks: [] });
  assert.deepEqual(switchKindText(null, { ...PASOS, subtaskTemplate: [] }, { title: "t", description: "", subtasks: [] }), { title: "t", description: "Pasos:\n", subtasks: [] });
});

test("describeKindAutomation resume y trunca", () => {
  assert.equal(describeKindAutomation({ titleTemplate: "", descriptionTemplate: "" }), null);
  assert.equal(describeKindAutomation({ titleTemplate: "Aviso", descriptionTemplate: "" }), "Al elegirlo, el título empieza por «Aviso».");
  assert.equal(describeKindAutomation({ titleTemplate: "", descriptionTemplate: "Pasos:" }), "Al elegirlo, la descripción empieza por «Pasos:».");
  const line = describeKindAutomation(RESP)!;
  assert.ok(line.includes("«Respuesta»") && line.includes("«Respondo a las preguntas y lo que necesitas de mí:»"));
  assert.ok(describeKindAutomation({ titleTemplate: "", descriptionTemplate: "a".repeat(100) })!.includes("…"));
});

test("subtareas predefinidas: una por línea, sin vacías ni repetidas", () => {
  assert.deepEqual(parseSubtaskLines("Revisar\n\n  Probar  \r\nrevisar\nDesplegar"), ["Revisar", "Probar", "Desplegar"]);
  assert.deepEqual(parseSubtaskLines(""), []);
  assert.equal(parseSubtaskLines(Array.from({ length: 80 }, (_, i) => `paso ${i}`).join("\n")).length, 50);
});

test("al elegir el tipo se añaden las subtareas que faltan", () => {
  const AB = { subtaskTemplate: ["A", "B"] };
  assert.deepEqual(switchKindSubtasks(null, AB, []), ["A", "B"]);
  assert.deepEqual(switchKindSubtasks(null, AB, ["b", "Extra"]), ["b", "Extra", "A"]);
  // Elegir el mismo tipo dos veces no duplica.
  assert.deepEqual(switchKindSubtasks(null, AB, switchKindSubtasks(null, AB, [])), ["A", "B"]);
  // Hasta el máximo de 50 (MAX_KIND_SUBTASKS), recortadas y sin vacías.
  assert.equal(switchKindSubtasks(null, { subtaskTemplate: ["n1", "n2"] }, Array.from({ length: 49 }, (_, i) => `x${i}`)).length, 50);
  assert.deepEqual(switchKindSubtasks(null, { subtaskTemplate: ["  C  ", "", "   "] }, []), ["C"]);
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
  // A un tipo sin prefijo: se quita el prefijo del anterior (también si acaba en palabra).
  assert.equal(switchKindTitle(PRESU, PLAIN, "Presupuesto:"), "");
  assert.equal(switchKindTitle(RESP, PLAIN, "Respuesta a Juan"), "a Juan");
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
  // Salud → Casa → Compras: «dentista» sigue ahí (sin el «Cita:» de Salud, que se quita al pasar a Casa).
  assert.equal(switchKindTitle(SALUD, CASA, "Cita: dentista"), "dentista");
  assert.equal(switchKindTitle(CASA, COMPRAS, switchKindTitle(SALUD, CASA, "Cita: dentista")), "Comprar dentista");
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

test("a un tipo sin prefijo se quita el prefijo del anterior (Casa → Reforma u obra → Casa)", () => {
  const CASA = { titleTemplate: "", descriptionTemplate: "" };
  // Como en la plantilla de serie: «Obra: » (con su espacio, que se recorta al comparar).
  const OBRA = { titleTemplate: "Obra: ", descriptionTemplate: "" };
  const ida = switchKindTitle(CASA, OBRA, "Pintar el salón");
  assert.equal(ida, "Obra: Pintar el salón");
  assert.equal(switchKindTitle(OBRA, CASA, ida), "Pintar el salón");
  // Ida y vuelta con el título vacío: no queda nada del prefijo.
  assert.equal(switchKindTitle(OBRA, CASA, switchKindTitle(CASA, OBRA, "")), "");
  // Con otro separador también («Compra - pan»).
  assert.equal(switchKindTitle({ titleTemplate: "Compra -", descriptionTemplate: "" }, CASA, "Compra - pan"), "pan");
  // Un prefijo que acaba en palabra también se quita («Comprar pan» pasa a «pan»), pero no dentro de otra palabra.
  assert.equal(switchKindTitle({ titleTemplate: "Comprar", descriptionTemplate: "" }, CASA, "Comprar pan"), "pan");
  assert.equal(switchKindTitle({ titleTemplate: "Comprar", descriptionTemplate: "" }, CASA, "Comprarlo todo"), "Comprarlo todo");
  // Escrito a mano sin el prefijo del anterior: no se toca.
  assert.equal(switchKindTitle(OBRA, CASA, "Pintar"), "Pintar");
});

test("el título: los prefijos no se acumulan al pasar por un tipo sin prefijo (Casa y familia)", () => {
  // Como en la plantilla de serie «Casa y familia»: Compras «Comprar », Papeleo «Gestionar », Cita «Cita: », Casa sin título.
  const COMPRAS = { titleTemplate: "Comprar ", descriptionTemplate: "" };
  const PAPELEO = { titleTemplate: "Gestionar ", descriptionTemplate: "" };
  const CITA = { titleTemplate: "Cita: ", descriptionTemplate: "" };
  const CASA = { titleTemplate: "", descriptionTemplate: "" };
  const kinds = [COMPRAS, CASA, PAPELEO, CITA];
  const steps: [typeof CASA, string][] = [[PAPELEO, "Gestionar renovar pasaporte"], [COMPRAS, "Comprar renovar pasaporte"], [CASA, "renovar pasaporte"], [PAPELEO, "Gestionar renovar pasaporte"], [CASA, "renovar pasaporte"]];
  let prev = CASA;
  let title = "renovar pasaporte";
  for (const [next, expected] of steps) {
    title = switchKindTitle(prev, next, title, kinds);
    assert.equal(title, expected);
    prev = next;
  }
  // El prefijo que quedó de otro tipo (no del anterior) también se cambia si acaba en signo («Cita:»).
  assert.equal(switchKindTitle(PAPELEO, CASA, "Cita: dentista", kinds), "dentista");
  assert.equal(switchKindTitle(CASA, PAPELEO, "Cita: dentista", kinds), "Gestionar dentista");
  // Uno que acaba en palabra solo si es del anterior: «Comprar regalo de Ana» lo escribió la persona en una tarea de Casa.
  assert.equal(switchKindTitle(CASA, CITA, "Comprar regalo de Ana", kinds), "Cita: Comprar regalo de Ana");
  assert.equal(switchKindTitle(CASA, PAPELEO, "Comprar entradas para el teatro", kinds), "Gestionar Comprar entradas para el teatro");
  assert.equal(switchKindTitle(COMPRAS, CITA, "Comprar regalo de Ana", kinds), "Cita: regalo de Ana");
  // Lo mismo con switchKindText (Nueva tarea).
  const tpl = (k: typeof CASA) => ({ ...k, subtaskTemplate: [] });
  assert.equal(switchKindText(tpl(CASA), tpl(PAPELEO), { title: "Comprar pan", description: "", subtasks: [] }, kinds).title, "Gestionar Comprar pan");
  assert.equal(switchKindText(tpl(CASA), tpl(PAPELEO), { title: "Cita: pan", description: "", subtasks: [] }, kinds).title, "Gestionar pan");
});

test("la descripción: la plantilla anterior sin tocar se cambia y lo escrito debajo se conserva", () => {
  const tpl = PRESU.descriptionTemplate.trim();
  assert.equal(switchKindDescription(PRESU, PERMISO, `${tpl}\n\nNotas mías`), `${PERMISO.descriptionTemplate.trim()}\n\nNotas mías`);
  assert.equal(switchKindDescription(PRESU, PLAIN, `${tpl}\n`), "");
  // Rellenada: la respuesta se conserva debajo del formulario nuevo y el apartado que sigue vacío se quita.
  const filled = tpl.replace("[nombre]", "Reformas López");
  const out = switchKindDescription(PRESU, PERMISO, filled);
  assert.equal(out, `${PERMISO.descriptionTemplate.trim()}\n\n**Empresa o profesional:** Reformas López\n`);
  assert.equal(switchKindDescription(PRESU, PERMISO, out), out);
  // Escrito en la misma línea que el final de la plantilla: también cuenta como respondido; el apartado con «[nombre]» sin
  // cambiar se quita.
  assert.equal(switchKindDescription(PRESU, PLAIN, `${tpl} todo el baño`), "**Alcance incluido:** todo el baño\n");
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
  // Los apartados de Salud sin responder se quitan.
  assert.equal(out, `${CASA.descriptionTemplate.trim()}\n\n**Preguntas para la consulta:**\nLlevar análisis\n`);
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

test("la descripción: al cambiar de tipo con el formulario a medias, cada respuesta va a su apartado y los vacíos se quitan", () => {
  // Informe de prueba: «Cambiar bombilla del pasillo» (Casa, plantilla «Casa y familia») → «Reforma u obra».
  const CASA = { titleTemplate: "", descriptionTemplate: "**Qué hay que hacer:**\n\n**Material necesario:**\n" };
  const OBRA = { titleTemplate: "Obra: ", descriptionTemplate: "**Estancia o zona:**\n\n**Qué hay que hacer:**\n\n**Quién lo hace y presupuesto:**\n\n**Fechas previstas:**\n" };
  const OBRA_WITH = (answer: string) => `**Estancia o zona:**\n\n${answer}\n\n**Quién lo hace y presupuesto:**\n\n**Fechas previstas:**\n`;
  // Escrito detrás de la etiqueta, en la misma línea (Markdown).
  assert.equal(switchKindDescription(CASA, OBRA, "**Qué hay que hacer:** cambiar la bombilla\n\n**Material necesario:**\n"), OBRA_WITH("**Qué hay que hacer:** cambiar la bombilla"));
  // Dentro de la negrita (el editor con barra sigue en negrita al escribir tras la etiqueta) y sin el salto final.
  assert.equal(switchKindDescription(CASA, OBRA, "**Qué hay que hacer: cambiar la bombilla**\n\n**Material necesario:**"), OBRA_WITH("**Qué hay que hacer: cambiar la bombilla**"));
  // En el párrafo siguiente (el editor con barra separa los párrafos con una línea en blanco).
  const out = switchKindDescription(CASA, OBRA, "**Qué hay que hacer:**\n\nCambiar la bombilla\n\n**Material necesario:**");
  assert.equal(out, OBRA_WITH("**Qué hay que hacer:**\n\nCambiar la bombilla"));
  assert.equal(out.match(/Qué hay que hacer/g)?.length, 1);
  assert.ok(!out.includes("Material necesario"));
  // Y de vuelta: la respuesta vuelve a su apartado y los de la obra sin responder desaparecen.
  assert.equal(switchKindDescription(OBRA, CASA, out), "**Qué hay que hacer:**\n\nCambiar la bombilla\n\n**Material necesario:**\n");
  // Una respuesta sin apartado en el tipo nuevo va debajo de su formulario; lo escrito aparte, al final.
  assert.equal(
    switchKindDescription(CASA, OBRA, "**Qué hay que hacer:**\n\n**Material necesario:** bombilla LED\n\nNotas mías"),
    `${OBRA.descriptionTemplate.trim()}\n\n**Material necesario:** bombilla LED\n\nNotas mías`,
  );
  // Con un apartado vacío borrado a mano, igual.
  assert.equal(switchKindDescription(CASA, OBRA, "**Qué hay que hacer:** pintar"), OBRA_WITH("**Qué hay que hacer:** pintar"));
  // Con algo escrito antes del formulario no se reconoce: se conserva entero (como antes).
  assert.equal(switchKindDescription(CASA, OBRA, "Ojo\n**Qué hay que hacer:** x\n**Material necesario:**"), `${OBRA.descriptionTemplate.trim()}\n\nOjo\n**Qué hay que hacer:** x\n**Material necesario:**`);
});

test("la descripción: la respuesta del último apartado en el párrafo siguiente sigue con su etiqueta", () => {
  // Con el editor con barra, «Bombilla LED» iba a parar bajo «Fechas previstas», como si fuera su respuesta.
  const CASA = { titleTemplate: "", descriptionTemplate: "**Qué hay que hacer:**\n\n**Material necesario:**\n" };
  const OBRA = { titleTemplate: "Obra: ", descriptionTemplate: "**Estancia o zona:**\n\n**Qué hay que hacer:**\n\n**Quién lo hace y presupuesto:**\n\n**Fechas previstas:**\n" };
  const typed = "**Qué hay que hacer:**\n\nCambiar la bombilla\n\n**Material necesario:**\n\nBombilla LED";
  const obra = switchKindDescription(CASA, OBRA, typed);
  assert.equal(
    obra,
    "**Estancia o zona:**\n\n**Qué hay que hacer:**\n\nCambiar la bombilla\n\n**Quién lo hace y presupuesto:**\n\n**Fechas previstas:**\n\n**Material necesario:**\n\nBombilla LED\n",
  );
  // Ida y vuelta: todo vuelve a su sitio, sin repetir nada.
  assert.equal(switchKindDescription(OBRA, CASA, obra), `${typed}\n`);
  // Al revés, con «En mayo» bajo el último apartado de la obra: no pasa a «Estancia o zona».
  const casa = switchKindDescription(OBRA, CASA, "**Estancia o zona:**\n\nBaño\n\n**Qué hay que hacer:**\n\n**Quién lo hace y presupuesto:**\n\n**Fechas previstas:**\n\nEn mayo");
  assert.equal(casa, "**Qué hay que hacer:**\n\n**Material necesario:**\n\n**Estancia o zona:**\n\nBaño\n\n**Fechas previstas:**\n\nEn mayo\n");
  assert.equal(
    switchKindDescription(CASA, OBRA, casa),
    "**Estancia o zona:**\n\nBaño\n\n**Qué hay que hacer:**\n\n**Quién lo hace y presupuesto:**\n\n**Fechas previstas:**\n\nEn mayo\n",
  );
  // Con varios párrafos, la respuesta entera se queda con su etiqueta.
  assert.equal(
    switchKindDescription(CASA, OBRA, "**Qué hay que hacer:** pintar\n\n**Material necesario:**\n\nbrocha\n\nrodillo"),
    "**Estancia o zona:**\n\n**Qué hay que hacer:** pintar\n\n**Quién lo hace y presupuesto:**\n\n**Fechas previstas:**\n\n**Material necesario:**\n\nbrocha\n\nrodillo\n",
  );
});

test("la descripción: las viñetas vacías de la plantilla son parte de su apartado, no etiquetas", () => {
  // Plantillas «Recados» y «Estudios»: una lista debajo de la etiqueta.
  const RECADOS = { titleTemplate: "", descriptionTemplate: "**Para quién o para qué:**\n\n**No olvidar:**\n\n- \n" };
  const ESTUDIO = { titleTemplate: "", descriptionTemplate: "**Tema o unidad:**\n\n**Qué tengo que saber:**\n\n- \n\n**Materiales:**\n" };
  const CASA = { titleTemplate: "", descriptionTemplate: "**Qué hay que hacer:**\n\n**Material necesario:**\n" };
  const list = "**Para quién o para qué:** mamá\n\n**No olvidar:**\n\n- pan\n- leche\n- huevos\n";
  // La lista de la compra no pasa a ser lo que hay que saber del tema: va con su etiqueta, debajo del formulario nuevo.
  const est = switchKindDescription(RECADOS, ESTUDIO, list);
  assert.equal(est, `${ESTUDIO.descriptionTemplate.trim()}\n\n${list}`);
  // Y de vuelta, sin «Para quién o para qué» dos veces.
  assert.equal(switchKindDescription(ESTUDIO, RECADOS, est), list);
  // Hacia «Casa», la lista no queda bajo «Material necesario».
  assert.equal(
    switchKindDescription(RECADOS, CASA, "**Para quién o para qué:**\n\n**No olvidar:**\n\n- pan\n- leche\n"),
    "**Qué hay que hacer:**\n\n**Material necesario:**\n\n**No olvidar:**\n\n- pan\n- leche\n",
  );
  // Una respuesta que va a un apartado con lista del tipo nuevo ocupa también el sitio de la viñeta vacía.
  assert.equal(
    switchKindDescription(RECADOS, ESTUDIO, "**Para quién o para qué:**\n\n**No olvidar:**\n\n-\n\n**Qué tengo que saber:**\n\n- derivadas\n"),
    "**Tema o unidad:**\n\n**Qué tengo que saber:**\n\n- derivadas\n\n**Materiales:**\n",
  );
  // La viñeta vacía, se guarde como «- » o como «-», no cuenta como respuesta.
  assert.equal(switchKindDescription(RECADOS, CASA, "**Para quién o para qué:** yo\n\n**No olvidar:**\n\n-"), `${CASA.descriptionTemplate.trim()}\n\n**Para quién o para qué:** yo\n`);
  // El formulario sin tocar con lo que ya había debajo: se cambia de formulario y se conserva lo de debajo.
  assert.equal(switchKindDescription(RECADOS, CASA, switchKindDescription(null, RECADOS, "Texto compartido")), `${CASA.descriptionTemplate.trim()}\n\nTexto compartido`);
});

test("la descripción: con un tipo sin plantilla en medio, el formulario no se repite al volver", () => {
  // «Mejora» → «Corrección» (tipo general, sin plantilla) → «Mejora»: antes se anteponía el formulario vacío a lo escrito.
  const MEJORA = { titleTemplate: "", descriptionTemplate: "**Qué mejora:**\n\n**Por qué:**\n\n**Cómo sabré que está bien:**\n" };
  const CORRECCION = { titleTemplate: "", descriptionTemplate: "" };
  const typed = "**Qué mejora:** el login\n\n**Por qué:**\n\n**Cómo sabré que está bien:**\n";
  const general = switchKindDescription(MEJORA, CORRECCION, typed);
  assert.equal(general, "**Qué mejora:** el login\n");
  const back = switchKindDescription(CORRECCION, MEJORA, general);
  assert.equal(back, typed);
  assert.equal(back.match(/Qué mejora/g)?.length, 1);
  // Lo escrito en el tipo general (sin forma de formulario) sigue yendo debajo de la plantilla, como antes.
  assert.equal(switchKindDescription(CORRECCION, MEJORA, "Falla al entrar"), `${MEJORA.descriptionTemplate.trim()}\n\nFalla al entrar`);
});

test("detalle: al cambiar de tipo se cambian las subtareas sin marcar y sin tocar del anterior", () => {
  const OLD = { subtaskTemplate: ["Pedir presupuesto", "Comparar", "Elegir"] };
  const NEW = { subtaskTemplate: ["Solicitar permiso", "comparar", "Pagar tasa"] };
  const row = (title: string, done = false) => ({ id: title, title, done });
  const rows = [row("Pedir presupuesto", true), row("Comparar"), row("Elegir lo más barato"), row("Elegir"), row("Mía")];
  const { remove, add } = switchKindSubtaskRows(OLD, NEW, rows, 100);
  // La marcada y la renombrada se quedan; «Comparar» también, porque el nuevo la tiene (no se mueve al final).
  assert.deepEqual(remove.map((r) => r.id), ["Elegir"]);
  assert.deepEqual(add, ["Solicitar permiso", "Pagar tasa"]);
  // El mismo tipo (o uno con las mismas subtareas): nada.
  assert.deepEqual(switchKindSubtaskRows(OLD, OLD, rows, 100), { remove: [], add: [] });
  // Sin tipo anterior con plantilla: solo se añaden; y nunca por encima del máximo de la tarea.
  assert.deepEqual(switchKindSubtaskRows({ subtaskTemplate: [] }, NEW, [row("comparar")], 2), { remove: [], add: ["Solicitar permiso"] });
  // Una repetida a mano: se quita una sola vez por cada una de la plantilla.
  assert.deepEqual(switchKindSubtaskRows(OLD, { subtaskTemplate: [] }, [row("Elegir"), { ...row("Elegir"), id: "x" }], 100).remove.map((r) => r.id), ["Elegir"]);
});

test("aviso del cambio de tipo: cuenta por separado lo añadido, lo quitado y la plantilla de la descripción", async () => {
  const { makeT } = await import("../src/i18n/core");
  const es = makeT("es");
  const en = makeT("en");
  assert.equal(kindChangeNotice(es, { added: 3, removed: 2 }), "Tipo cambiado: 3 subtareas añadidas y 2 quitadas");
  assert.equal(kindChangeNotice(es, { added: 1, removed: 0 }), "Tipo cambiado: 1 subtarea añadida");
  assert.equal(kindChangeNotice(es, { added: 0, removed: 1 }), "Tipo cambiado: 1 subtarea quitada");
  assert.equal(kindChangeNotice(es, { added: 0, removed: 2, description: "applied" }), "Tipo cambiado: 2 subtareas quitadas y plantilla de la descripción aplicada");
  assert.equal(kindChangeNotice(es, { added: 3, removed: 1, description: "applied" }), "Tipo cambiado: 3 subtareas añadidas, 1 quitada y plantilla de la descripción aplicada");
  assert.equal(kindChangeNotice(es, { added: 0, removed: 0, description: "applied" }), "Tipo cambiado: plantilla de la descripción aplicada");
  assert.equal(kindChangeNotice(es, { added: 0, removed: 0 }), null);
  assert.equal(kindChangeNotice(en, { added: 3, removed: 2 }), "Type changed: 3 subtasks added and 2 removed");
  assert.equal(kindChangeNotice(es, { added: 0, removed: 0, description: "removed" }), "Tipo cambiado: plantilla de la descripción quitada");
  assert.equal(kindChangeNotice(es, { added: 1, removed: 0, description: "applied" }), "Tipo cambiado: 1 subtarea añadida y plantilla de la descripción aplicada");
  assert.equal(kindChangeNotice(es, { added: 0, removed: 0, description: null }), null);
  assert.equal(kindChangeNotice(en, { added: 0, removed: 0, description: "removed" }), "Type changed: description template removed");
});

test("aviso del cambio de tipo: dice lo que de verdad le ha pasado a la descripción", () => {
  const CORRECCION = { titleTemplate: "", descriptionTemplate: "" };
  const CASA = { titleTemplate: "", descriptionTemplate: "**Qué hay que hacer:**\n\n**Material necesario:**\n" };
  const change = (prev: typeof CASA | null, next: typeof CASA, before: string) => kindDescriptionChange(next, before, switchKindDescription(prev, next, before));
  // De un tipo con plantilla («Respuesta») a uno sin ella («Corrección»).
  assert.equal(change(RESP, CORRECCION, ""), null);
  assert.equal(change(RESP, CORRECCION, "Lo que escribí yo"), null);
  assert.equal(change(RESP, CORRECCION, `${RESPUESTA_LINE}\n`), "removed");
  assert.equal(change(RESP, CORRECCION, `${RESPUESTA_LINE}\n\nLo que escribí yo`), "removed");
  // El formulario respondido se queda (solo cambian los saltos de línea): nada que avisar.
  assert.equal(change(RESP, CORRECCION, `${RESPUESTA_LINE}\nMi respuesta`), null);
  // A un tipo con plantilla: aplicada (también si sustituye a la del anterior).
  assert.equal(change(CORRECCION, RESP, ""), "applied");
  assert.equal(change(CORRECCION, RESP, "Lo que escribí yo"), "applied");
  assert.equal(change(RESP, CASA, `${RESPUESTA_LINE}\n`), "applied");
  // Ya la tenía: no cambia.
  assert.equal(change(CORRECCION, RESP, `${RESPUESTA_LINE}\n`), null);
});

test("el título sin el prefijo del tipo (para nombrar la tarea en Logs y en el deshacer)", () => {
  const kinds = [{ titleTemplate: "Mudanza: ", descriptionTemplate: "" }, { titleTemplate: "Gestionar", descriptionTemplate: "" }, { titleTemplate: "", descriptionTemplate: "" }];
  assert.equal(titleWithoutKindPrefix("Mudanza: Varias dos", kinds), "Varias dos");
  assert.equal(titleWithoutKindPrefix("Gestionar Varias dos", kinds), "Varias dos");
  assert.equal(titleWithoutKindPrefix("Gestionarlo todo", kinds), "Gestionarlo todo");
  assert.equal(titleWithoutKindPrefix("Mudanza:", kinds), "Mudanza:");
  assert.equal(titleWithoutKindPrefix("Varias dos", kinds), "Varias dos");
});

test("la descripción a medio editar: al cambiar de tipo no se pierde nada de lo escrito", () => {
  const CASA = { titleTemplate: "", descriptionTemplate: "**Qué hay que hacer:**\n\n**Material necesario:**\n" };
  const OBRA = { titleTemplate: "Obra: ", descriptionTemplate: "**Estancia o zona:**\n\n**Qué hay que hacer:**\n\n**Fechas previstas:**\n" };
  const NADA = { titleTemplate: "", descriptionTemplate: "" };
  // Lo escrito por la persona en cada caso (respuestas a medias, notas sueltas, texto sin formulario).
  const cases: [typeof CASA | null, typeof CASA, string, string[]][] = [
    [CASA, OBRA, "**Qué hay que hacer:** pintar la pared\n\n**Material necesario:**\n", ["pintar la pared"]],
    [CASA, OBRA, "**Qué hay que hacer:**\n\n**Material necesario:** rodillo y pintu", ["rodillo y pintu"]],
    [CASA, OBRA, "**Qué hay que hacer:** pintar\n\n**Material necesario:** rodillo\n\nNotas: llamar antes", ["pintar", "rodillo", "Notas: llamar antes"]],
    [CASA, NADA, "**Qué hay que hacer:** pintar\n\n**Material necesario:**\n", ["pintar"]],
    [NADA, OBRA, "Texto libre a medias", ["Texto libre a medias"]],
    [CASA, OBRA, "Ojo: antes de nada\n**Qué hay que hacer:** x", ["Ojo: antes de nada", "x"]],
  ];
  for (const [prev, next, typed, kept] of cases) {
    const out = switchKindDescription(prev, next, typed);
    for (const piece of kept) assert.ok(out.includes(piece), `«${piece}» se ha perdido: ${JSON.stringify(out)}`);
    // Y de vuelta al tipo anterior, tampoco.
    if (prev) for (const piece of kept) assert.ok(switchKindDescription(next, prev, out).includes(piece), `«${piece}» se ha perdido al volver`);
  }
});
