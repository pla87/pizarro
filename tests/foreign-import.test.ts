// Importar desde otros Kanban: lector del JSON de Trello, lector del CSV genérico (separadores, comillas, BOM, cabeceras de
// Asana, GitHub Projects, Wekan…), detección de formato y saneado de textos. Las pruebas con base de datos están en tests/db/foreign-import.test.ts.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test, describe } from "node:test";
import { makeT } from "../src/i18n/core";
import { detectDelimiter, mapHeaders, parseCsv, parseCsvBoard } from "../src/lib/foreign-import/csv";
import { assertBoardLimits, decodeText, foreignMaxBytes, parseForeign, sniffFormat } from "../src/lib/foreign-import/parse";
import { cleanMarkdown, cleanName, cleanTitle, instantDay, isDoneName, parseDay, stripHtml } from "../src/lib/foreign-import/text";
import { parseTrello } from "../src/lib/foreign-import/trello";

const t = makeT("es");
const trelloText = readFileSync(new URL("./fixtures/trello-board.json", import.meta.url), "utf8");
const bytes = (s: string) => new TextEncoder().encode(s);
const csv = (text: string, fileName = "tareas") => parseCsvBoard(text, { t, fileName });

describe("Trello JSON", () => {
  const board = parseTrello(trelloText, { t, timeZone: "Europe/Madrid" });
  const task = (title: string) => board.tasks.find((x) => x.title === title)!;

  test("nombre y descripción del tablero; las listas abiertas son las columnas, en el orden de pos", () => {
    assert.equal(board.name, "Lanzamiento web");
    assert.deepEqual(board.columns, ["Por hacer", "En curso", "Hecho"]);
    assert.match(board.description, /^Tablero del \*\*lanzamiento\*\* de la web\./);
    assert.doesNotMatch(board.description, /<script|alert/);
  });

  test("las tarjetas quedan por columna y por posición; la que no tiene título se ignora", () => {
    assert.deepEqual(board.tasks.map((x) => x.title), ["Elegir el dominio", "Redactar los textos", "Maquetar la portada", "Contratar el hosting", "Chat en vivo"]);
    assert.equal(task("Redactar los textos").column, 0);
    assert.equal(task("Maquetar la portada").column, 1);
  });

  test("archivadas: closed y las de una lista archivada (que cae en la primera columna, con nota)", () => {
    assert.equal(task("Contratar el hosting").archived, true);
    const old = task("Chat en vivo");
    assert.equal(old.archived, true);
    assert.equal(old.column, null);
    assert.match(old.description, /Lista de Trello archivada: Ideas descartadas\./);
    assert.equal(task("Elegir el dominio").archived, false);
  });

  test("fecha límite: el instante UTC pasa al día de la zona horaria", () => {
    assert.equal(task("Redactar los textos").due, "2026-12-16"); // 23:30Z ya es el 16 en Madrid
    assert.equal(task("Maquetar la portada").due, "2026-11-30");
    assert.equal(task("Elegir el dominio").due, null);
    assert.equal(parseTrello(trelloText, { t }).tasks.find((x) => x.title === "Redactar los textos")!.due, "2026-12-15");
  });

  test("etiquetas con su color aproximado a la paleta; sin nombre, el del color", () => {
    assert.deepEqual(task("Redactar los textos").labels, [{ name: "Diseño", color: "#a855f7" }, { name: "Rojo", color: "#ef4444" }]);
    assert.deepEqual(task("Maquetar la portada").labels, [{ name: "Frontend", color: "#0ea5e9" }, { name: "Listo", color: "#166534" }]);
  });

  test("checklists → subtareas con su estado, ordenadas por pos; con varias listas, con su nombre delante", () => {
    assert.deepEqual(task("Redactar los textos").subtasks, [{ title: "Primer borrador", done: true }, { title: "Revisar con Ana", done: false }]);
    assert.deepEqual(task("Maquetar la portada").subtasks, [{ title: "Diseño: Cabecera", done: true }, { title: "Código: Responsive", done: false }]);
  });

  test("comentarios: del más antiguo al más nuevo, con el autor original y la fecha citados", () => {
    const comments = task("Redactar los textos").comments;
    assert.equal(comments.length, 2);
    assert.equal(comments[0]!.body, "**Ana Ejemplo comentó en Trello el 2026-10-30:**\n\nEmpiezo hoy.");
    assert.equal(comments[1]!.body, "**Luis Muestra comentó en Trello el 2026-11-02:**\n\nMejor lo vemos el lunes.");
    assert.equal(comments[0]!.createdAt?.toISOString(), "2026-10-30T18:00:00.000Z");
  });

  test("adjuntos: solo los enlaces, en la descripción; los subidos a Trello no se descargan y se avisa", () => {
    const d = task("Redactar los textos").description;
    assert.match(d, /\*\*Adjuntos de Trello\*\*\n- \[Guía de estilo\]\(https:\/\/example\.com\/guia-%28v2%29\.pdf\)/);
    assert.doesNotMatch(d, /logo\.png/);
    assert.match(d, /Tarjeta original en Trello: https:\/\/trello\.example\.com\/c\/abc123/);
    assert.ok(board.warnings.includes("1 archivo adjunto subido a Trello no se ha importado (solo se importan los enlaces)."), board.warnings.join(" | "));
  });

  test("descripción: Markdown conservado, HTML en bruto y enlaces javascript: fuera, y las menciones falsas desactivadas", () => {
    const d = task("Redactar los textos").description;
    assert.match(d, /^Textos de la \*\*portada\*\* y del pie\.\n\n- Portada\n- Pie/);
    assert.doesNotMatch(d, /<img|onerror|javascript:/);
    assert.match(d, /pulsa y @/);
    assert.doesNotMatch(d, /pulsa\)/);
    assert.doesNotMatch(d, /@\[Falso\]\(user:/);
  });

  test("miembros: nombres como responsables posibles (sin email)", () => {
    assert.deepEqual(task("Redactar los textos").assignees, [{ email: null, name: "Ana Ejemplo" }, { email: null, name: "Luis Muestra" }]);
  });

  test("JSON inválido o que no es de Trello da un error claro", () => {
    assert.throws(() => parseTrello("{no json", { t }), /no es un JSON válido/);
    assert.throws(() => parseTrello('{"a":1}', { t }), /exportación de un tablero de Trello/);
    assert.throws(() => parseTrello("[]", { t }), /exportación de un tablero de Trello/);
  });

  test("sin nombre de tablero, el del archivo", () => {
    assert.equal(parseTrello('{"lists":[],"cards":[]}', { t, fileName: "mi-tablero" }).name, "mi-tablero");
  });
});

describe("CSV: lectura RFC 4180", () => {
  test("separador autodetectado: coma, punto y coma y tabulador (las comillas no cuentan)", () => {
    assert.equal(detectDelimiter("a,b,c\n1,2,3"), ",");
    assert.equal(detectDelimiter("a;b;c\n1;2;3"), ";");
    assert.equal(detectDelimiter("a\tb\tc\n1\t2\t3"), "\t");
    assert.equal(detectDelimiter('"a,b,c";d\n1;2'), ";");
    assert.equal(detectDelimiter("solo"), ",");
  });

  test("comillas, comillas dobles, separadores y saltos de línea dentro de un campo, CRLF y BOM", () => {
    const rows = parseCsv('﻿título,descripción\r\n"Una, con coma","Dice ""hola""\r\ny adiós"\r\nSimple,\r\n');
    assert.deepEqual(rows, [["título", "descripción"], ["Una, con coma", 'Dice "hola"\r\ny adiós'], ["Simple", ""]]);
  });

  test("punto y coma con comas dentro; líneas vacías ignoradas; última fila sin salto de línea", () => {
    assert.deepEqual(parseCsv("a;b\n\n1,5;x\n\n2;y"), [["a", "b"], ["1,5", "x"], ["2", "y"]]);
  });

  test("campo entre comillas vacío en una fila de una sola columna se conserva; una comilla en mitad de un campo es literal", () => {
    assert.deepEqual(parseCsv('a\n""\n5" pulgadas'), [["a"], [""], ['5" pulgadas']]);
  });

  test("UTF-8 con BOM y Windows-1252 (Excel) se decodifican bien; UTF-16 con BOM también", () => {
    assert.equal(decodeText(bytes("\uFEFFñ")), "ñ");
    assert.equal(decodeText(new Uint8Array([0x74, 0xed, 0x74, 0x75, 0x6c, 0x6f])), "título");
    assert.equal(decodeText(new Uint8Array([0xff, 0xfe, 0x61, 0x00, 0xf1, 0x00])), "añ");
  });
});

describe("CSV: tablero", () => {
  test("cabeceras en español, con ; y BOM; columnas por orden de aparición; etiquetas con coma o punto y coma", () => {
    const b = csv(
      "﻿Título;Descripción;Estado;Etiquetas;Fecha límite;Prioridad\n" +
        'Preparar demo;"Con ""comillas""\ny salto";En curso;ui, backend;2026-12-01;Alta\n' +
        "Escribir docs;Notas;Por hacer;docs;31/12/2026;baja\n" +
        "Otra tarea;;En curso;ui;;\n",
      "plan-q4",
    );
    assert.equal(b.name, "plan-q4");
    assert.deepEqual(b.columns, ["En curso", "Por hacer"]);
    assert.equal(b.tasks.length, 3);
    const [a, d, o] = b.tasks;
    assert.equal(a!.title, "Preparar demo");
    assert.equal(a!.description, 'Con "comillas"\ny salto');
    assert.equal(a!.column, 0);
    assert.deepEqual(a!.labels.map((l) => l.name), ["ui", "backend"]);
    assert.equal(a!.due, "2026-12-01");
    assert.equal(a!.priority, "ALTA");
    assert.equal(d!.column, 1);
    assert.equal(d!.due, "2026-12-31");
    assert.equal(d!.priority, "BAJA");
    assert.equal(o!.column, 0);
    assert.deepEqual(o!.labels.map((l) => l.name), ["ui"]);
  });

  test("sin columna de estado: todo a la primera columna (columnas vacías = las de por defecto) y sin avisos", () => {
    const b = csv("Title,Notes\nA,uno\nB,dos");
    assert.deepEqual(b.columns, []);
    assert.deepEqual(b.tasks.map((x) => x.column), [null, null]);
    assert.deepEqual(b.warnings, []);
  });

  test("estado vacío en una fila: va a la primera columna; los mismos estados con otra mayúscula son una columna", () => {
    const b = csv("name,status\nA,Todo\nB,\nC,TODO\nD,Done");
    assert.deepEqual(b.columns, ["Todo", "Done"]);
    assert.deepEqual(b.tasks.map((x) => x.column), [0, null, 0, 1]);
  });

  test("exportación de Asana: Name, Notes, Section/Column, Assignee Email, Due Date, Tags y subtareas por «Parent task»", () => {
    const b = csv(
      "Task ID,Created At,Completed At,Last Modified,Name,Assignee,Assignee Email,Start Date,Due Date,Tags,Notes,Projects,Parent task,Section/Column\n" +
        "1201,2026-09-01,,2026-09-02,Diseñar el logo,Ana Ejemplo,ana@example.com,,2026-10-05,\"marca, diseño\",Tres propuestas,Rebranding,,Backlog\n" +
        "1202,2026-09-01,2026-09-10,2026-09-10,Moodboard,Ana Ejemplo,ana@example.com,,,,,Rebranding,Diseñar el logo,Backlog\n" +
        "1203,2026-09-01,,2026-09-02,Paleta,,,,,,,Rebranding,Diseñar el logo,Backlog\n" +
        "1204,2026-09-01,,2026-09-02,Contratar imprenta,,,,2026-10-20,,,Rebranding,,Hecho\n",
    );
    assert.deepEqual(b.columns, ["Backlog", "Hecho"]);
    assert.equal(b.tasks.length, 2);
    const logo = b.tasks[0]!;
    assert.equal(logo.title, "Diseñar el logo");
    assert.equal(logo.description, "Tres propuestas\n\n_Referencia original: 1201_");
    assert.deepEqual(logo.assignees, [{ email: "ana@example.com", name: "Ana Ejemplo" }]);
    assert.equal(logo.due, "2026-10-05");
    assert.deepEqual(logo.labels.map((l) => l.name), ["marca", "diseño"]);
    assert.deepEqual(logo.subtasks, [{ title: "Moodboard", done: true }, { title: "Paleta", done: false }]);
    assert.equal(b.tasks[1]!.column, 1);
  });

  test("cabecera repetida: solo cuenta la primera; etiquetas y responsables juntan columnas de nombres distintos", () => {
    const b = csv(
      "Summary,Status,Status,Priority,Due Date,Labels,Labels,Tags,Owner,Members,Description,Description\n" +
        'Arreglar el login,In Progress,Bloqueada,Highest,15/Jan/26 10:20 AM,auth,urgente,web,ana@example.com,Luis,"Falla con ""SSO""",otra\n' +
        "Documentar la API,To Do,,Low,,docs,,,,,,\n",
    );
    assert.deepEqual(b.columns, ["In Progress", "To Do"]);
    const [a, d] = b.tasks;
    assert.equal(a!.title, "Arreglar el login");
    assert.equal(a!.priority, "URGENTE");
    assert.equal(a!.due, "2026-01-15");
    assert.deepEqual(a!.labels.map((l) => l.name), ["auth", "web"]);
    assert.deepEqual(a!.assignees, [{ email: "ana@example.com", name: null }, { email: null, name: "Luis" }]);
    assert.equal(a!.description, 'Falla con "SSO"');
    assert.equal(d!.priority, "BAJA");
    assert.deepEqual(d!.labels.map((l) => l.name), ["docs"]);
  });

  test("«Issue key», «Key», «Issue Type», «Parent» y «Parent summary» no son cabeceras reconocidas", () => {
    assert.deepEqual(Object.keys(mapHeaders(["Summary", "Issue key", "Key", "Issue Type", "Parent", "Parent summary"]).columns), ["title"]);
    const b = csv("Summary,Issue key,Parent,Parent summary\nMadre,PRJ-1,,\nHija,PRJ-2,PRJ-1,Madre\n");
    assert.deepEqual(b.tasks.map((x) => [x.title, x.description, x.subtasks.length]), [["Madre", "", 0], ["Hija", "", 0]]);
    // La referencia y la tarea madre genéricas siguen valiendo.
    const g = csv("Title,ID,Parent task\nMadre,7,\nHija,8,Madre\n");
    assert.deepEqual(g.tasks.map((x) => [x.title, x.description, x.subtasks]), [["Madre", "_Referencia original: 7_", [{ title: "Hija", done: false }]]]);
  });

  test("las columnas que cuentan como terminadas van al final; el resto conserva su orden de aparición", () => {
    const b = csv("title,status\nA,Hecho\nB,Por hacer\nC,Cerrado\nD,En curso\nE,Por hacer\nF,\nG,hecho\n");
    assert.deepEqual(b.columns, ["Por hacer", "En curso", "Hecho", "Cerrado"]);
    assert.deepEqual(b.tasks.map((x) => [x.title, x.column]), [["A", 2], ["B", 0], ["C", 3], ["D", 1], ["E", 0], ["F", null], ["G", 2]]);
    assert.deepEqual(csv("name,status\nA,Todo\nB,Done\nC,Doing").columns, ["Todo", "Doing", "Done"]);
    // Todas terminadas o ninguna: el orden no cambia.
    assert.deepEqual(csv("name,status\nA,Done\nB,Completed").columns, ["Done", "Completed"]);
    assert.deepEqual(csv("name,status\nA,Uno\nB,Dos").columns, ["Uno", "Dos"]);
  });

  test("isDoneName: los nombres de columna terminada en español e inglés", () => {
    for (const name of ["Hecho", "Done", "Completed", "Completadas", "Cerrado", "Closed", "Resuelto", "En producción", "Terminado ✔", "  DONE  "]) assert.ok(isDoneName(name), name);
    for (const name of ["Por hacer", "En curso", "To Do", "Doing", "Not done", "Revisión"]) assert.ok(!isDoneName(name), name);
  });

  test("GitHub Projects / Wekan / Kanboard / Notion: cabeceras típicas reconocidas", () => {
    const gh = mapHeaders(["Title", "Assignees", "Status", "Labels", "Milestone", "Repository"]).columns;
    assert.deepEqual([gh.title, gh.assignee, gh.column, gh.labels], [[0], [1], [2], [3]]);
    const wekan = mapHeaders(["Title", "Description", "Stage", "Owner", "Members", "Labels", "Due Date", "Created at"]).columns;
    assert.deepEqual([wekan.title, wekan.description, wekan.column, wekan.labels, wekan.due], [[0], [1], [2], [5], [6]]);
    const kanboard = mapHeaders(["Task Id", "Reference", "Title", "Description", "Assignee", "Column", "Category", "Date Due", "Priority"]).columns;
    assert.deepEqual([kanboard.key, kanboard.title, kanboard.column, kanboard.labels, kanboard.due, kanboard.priority], [[0], [2], [5], [6], [7], [8]]);
    const notion = mapHeaders(["Name", "Status", "Tags", "Due", "Assign"]).columns;
    assert.deepEqual([notion.title, notion.column, notion.labels, notion.due, notion.assignee], [[0], [1], [2], [3], [4]]);
    const es = mapHeaders(["Título", "Descripción", "Columna", "Etiquetas", "Fecha límite", "Responsable", "Prioridad"]).columns;
    assert.deepEqual(Object.values(es), [[0], [1], [2], [3], [4], [5], [6]]);
  });

  test("responsable: varios, con email o nombre; email suelto + nombre suelto son la misma persona", () => {
    const b = csv('title,assignee,assignee email\nA,"Ana Ejemplo, Luis <luis@example.com>",\nB,Pepe,pepe@example.com\nC,"x@example.com",');
    assert.deepEqual(b.tasks[0]!.assignees, [{ email: null, name: "Ana Ejemplo" }, { email: "luis@example.com", name: "Luis" }]);
    assert.deepEqual(b.tasks[1]!.assignees, [{ email: "pepe@example.com", name: "Pepe" }]);
    assert.deepEqual(b.tasks[2]!.assignees, [{ email: "x@example.com", name: null }]);
  });

  test("fechas y prioridades que no se entienden se ignoran con un aviso; filas sin título también", () => {
    const b = csv("title,due,priority\nA,mañana,rarísima\nB,2026-02-30,\n,2026-01-01,alta");
    assert.equal(b.tasks.length, 2);
    assert.deepEqual(b.tasks.map((x) => x.due), [null, null]);
    assert.deepEqual(b.tasks.map((x) => x.priority), [null, null]);
    assert.equal(b.warnings.length, 3);
    assert.ok(b.warnings.some((w) => /2 fechas límite/.test(w)));
    // Con uno solo, en singular (antes «1 prioridades no se reconocieron», «1 filas no tenían título»).
    assert.ok(b.warnings.includes("1 prioridad no se reconoció y se ha ignorado."), b.warnings.join(" | "));
    assert.ok(b.warnings.includes("1 fila no tenía título y se ha ignorado."), b.warnings.join(" | "));
  });

  test("columna «archivada»", () => {
    const b = csv("title,archived\nA,true\nB,no\nC,");
    assert.deepEqual(b.tasks.map((x) => x.archived), [true, false, false]);
  });

  test("sin columna de título reconocible, solo cabecera o sin tareas: error", () => {
    assert.throws(() => csv("a,b\n1,2"), /columna de título/);
    assert.throws(() => csv("title,status"), /no tiene filas/);
    assert.throws(() => csv("title\n,\n"), /no tiene filas|ninguna fila con título/);
  });

  test("más de 30 estados distintos: error al comprobar los topes; 30 caben", () => {
    const rows = (n: number) => `title,status\n${Array.from({ length: n }, (_, i) => `T${i},Estado ${i}`).join("\n")}`;
    assert.throws(() => parseForeign(rows(31), "csv", { t }), /más de 30 columnas/);
    assert.equal(parseForeign(rows(30), "csv", { t }).columns.length, 30);
  });

  test("más de 1000 tareas activas: error; las archivadas no cuentan", () => {
    const many = (n: number, archived: boolean) => `title,archived\n${Array.from({ length: n }, (_, i) => `T${i},${archived}`).join("\n")}`;
    assert.throws(() => parseForeign(many(1001, false), "csv", { t }), /1000 tareas activas/);
    assert.equal(parseForeign(many(1001, true), "csv", { t }).tasks.length, 1001);
  });

  test("textos recortados a los máximos y saneados: título 210, descripción 20 000, HTML fuera", () => {
    const b = csv(`title,description\n"${"x".repeat(300)}","<b>negrita</b> <script>mal()</script>${"y".repeat(25_000)}"`);
    assert.equal(b.tasks[0]!.title.length, 210);
    assert.equal(b.tasks[0]!.description.length, 20_000);
    assert.doesNotMatch(b.tasks[0]!.description, /<|mal\(\)/);
    assert.ok(b.tasks[0]!.description.startsWith("negrita "));
    assert.ok(b.warnings.some((w) => /textos eran más largos/.test(w)));
  });
});

describe("fechas, saneado y detección de formato", () => {
  test("parseDay", () => {
    assert.equal(parseDay("2026-03-04"), "2026-03-04");
    assert.equal(parseDay("2026-03-04T23:30:00Z", "Europe/Madrid"), "2026-03-05");
    assert.equal(parseDay("04/03/2026"), "2026-03-04");
    assert.equal(parseDay("31/12/26"), "2026-12-31");
    assert.equal(parseDay("12/31/2026"), "2026-12-31"); // el segundo número no puede ser mes: mes primero
    assert.equal(parseDay("4 de marzo de 2026"), "2026-03-04");
    assert.equal(parseDay("March 4, 2026"), "2026-03-04");
    assert.equal(parseDay("15/Jan/26 10:20 AM"), "2026-01-15");
    assert.equal(parseDay("2026-02-30"), null);
    assert.equal(parseDay("pronto"), null);
  });

  test("cleanMarkdown: sin HTML, sin controles ni esquemas peligrosos; conserva Markdown y enlaces http", () => {
    const md = cleanMarkdown("Hola <b>mundo</b>\u0000\u0007<iframe src=x></iframe>\n\n[ok](https://example.com) [mal](data:text/html;base64,AAA) <https://example.com/auto>\n![x](javascript:1)");
    assert.equal(md, "Hola mundo\n\n[ok](https://example.com) mal <https://example.com/auto>\nx");
  });

  test("sniffFormat: por contenido, la extensión solo desempata", () => {
    assert.equal(sniffFormat(new Uint8Array([0x50, 0x4b, 3, 4, 0]), "x.bin"), "pizarro");
    assert.equal(sniffFormat(bytes('{"cards":[]}'), "board.json"), "trello");
    assert.equal(sniffFormat(bytes('﻿  {"cards":[]}'), "sin-extension"), "trello");
    assert.equal(sniffFormat(bytes("title,status\nA,B"), "tareas.csv"), "csv");
    assert.equal(sniffFormat(bytes("title;status\nA;B"), "tareas"), "csv");
    assert.equal(sniffFormat(bytes("hola"), "x.json"), null);
    assert.equal(sniffFormat(new Uint8Array([0, 1, 2, 3, 4]), "x.csv"), null);
    assert.equal(sniffFormat(bytes("   "), "x.csv"), null);
    assert.equal(sniffFormat(bytes("texto"), "roto.zip"), "pizarro");
  });

  test("foreignMaxBytes: 25 MB para JSON y CSV, o PROJECT_IMPORT_MAX_MB si es menor", () => {
    const MB = 1024 * 1024;
    assert.equal(foreignMaxBytes(""), 25 * MB);
    assert.equal(foreignMaxBytes("500"), 25 * MB);
    assert.equal(foreignMaxBytes("25"), 25 * MB);
    assert.equal(foreignMaxBytes("10"), 10 * MB);
    assert.equal(foreignMaxBytes("0.5"), 0.5 * MB);
    assert.equal(foreignMaxBytes("no"), 25 * MB);
  });

  test("assertBoardLimits acepta un tablero normal", () => {
    assert.doesNotThrow(() => assertBoardLimits(parseForeign(trelloText, "trello", { t })));
  });
});

describe("entradas hostiles y rendimiento", () => {
  /** Ejecuta `fn` y comprueba que tarda menos de `ms` (cotas muy holgadas: lo cuadrático tardaría decenas de segundos). */
  function fast<R>(ms: number, fn: () => R): R {
    const t0 = performance.now();
    const out = fn();
    const took = performance.now() - t0;
    assert.ok(took < ms, `tardó ${Math.round(took)} ms (máximo ${ms})`);
    return out;
  }

  test("una línea de 80.000 «[» y 80.000 «<!--» se sanean rápido, también sin recortar de antemano", () => {
    fast(1500, () => cleanMarkdown("[".repeat(80_000), 1_000_000));
    fast(1500, () => cleanMarkdown("<!--".repeat(80_000), 1_000_000));
    fast(1500, () => stripHtml("<script>".repeat(80_000)));
    fast(1500, () => stripHtml("<script ".repeat(80_000)));
    fast(1500, () => stripHtml("<img ".repeat(30_000)));
    fast(1500, () => cleanMarkdown("[a](b:".repeat(80_000), 1_000_000));
    fast(1500, () => cleanMarkdown("](a:(x)".repeat(80_000), 1_000_000));
    fast(1500, () => cleanTitle("[".repeat(500_000)));
    fast(1500, () => cleanName("<!--".repeat(500_000), 40));
    // Con los máximos normales la entrada se recorta antes de sanear y el resultado respeta el tope.
    const clipped = { n: 0 };
    const md = fast(500, () => cleanMarkdown("[".repeat(500_000), undefined, clipped));
    assert.equal(md.length, 20_000);
    assert.equal(clipped.n, 1);
  });

  test("recortar la entrada en bruto cuenta un aviso aunque lo que quede sea corto", () => {
    const clipped = { n: 0 };
    const md = cleanMarkdown(`${"<br/><br/>".repeat(1000)}fin`, 1000, clipped);
    assert.equal(md, "");
    assert.equal(clipped.n, 1);
    const ok = { n: 0 };
    cleanMarkdown("corto", 1000, ok);
    cleanTitle("corto", 200, ok);
    assert.equal(ok.n, 0);
  });

  test("stripHtml conserva el texto técnico que solo parece una etiqueta", () => {
    const tech = "Devuelve Promise<void> y <T> en Map<K, V>; escribe a <tu-email> o <https://example.com/x>";
    assert.equal(stripHtml(tech), tech);
    assert.equal(cleanMarkdown("Usa `Array<string>` con <T>"), "Usa `Array<string>` con <T>");
    assert.equal(cleanTitle("Arreglar Promise<void> en <T>"), "Arreglar Promise<void> en <T>");
  });

  test("stripHtml quita las etiquetas conocidas, los bloques peligrosos con su contenido y los comentarios", () => {
    assert.equal(stripHtml("a<b>b</b><P CLASS=x>c</P><br/>d<span style='x'>e</span><img src=x>f"), "abc\n\ndef");
    assert.equal(stripHtml("x<script>alert(1)</script>y<STYLE>p{}</STYLE>z<iframe src=a></iframe><object data=b></object><embed src=c>w"), "xyzw");
    assert.equal(stripHtml("x<!-- <b>oculto</b> -->y"), "xy");
    assert.equal(stripHtml("x<script>sin cierre"), "xsin cierre");
    assert.equal(stripHtml("un <!-- sin cierre"), "un <!-- sin cierre");
    assert.equal(stripHtml("<scr<script></script>ipt>alert(1)</scr<script></script>ipt>"), "");
  });

  test("stripHtml repite hasta que no cambia: «<img … <b>>» no deja una etiqueta", () => {
    assert.equal(stripHtml("a<img src=x onerror=1 <b>>b"), "ab");
    assert.equal(cleanMarkdown("<img src=x onerror=alert(1) <b>>hola"), "hola");
    assert.equal(stripHtml("<i <i <i <i x>>>>ok"), "ok");
    // Anidados a miles de niveles: la repetición está acotada y no se cuelga.
    fast(3000, () => stripHtml(`${"<i ".repeat(20_000)}x${">".repeat(20_000)}`));
  });

  test("los enlaces a #mention- y #u quedan solo como texto; los https se conservan", () => {
    assert.equal(cleanMarkdown("[@Admin](#mention-abc) dice [hola](#u) y [x](#user)"), "@Admin dice hola y x");
    assert.equal(cleanMarkdown("[@Admin]( <#mention-abc> )"), "@Admin");
    assert.equal(cleanMarkdown("![@Admin](#mention-abc)"), "@Admin");
    assert.equal(cleanMarkdown("[@Admin][m]\n\n[m]: #mention-abc\n[ok](https://example.com/a_(b)) [m](mailto:a@example.com)"), "[@Admin][m]\n\n[ok](https://example.com/a_(b)) [m](mailto:a@example.com)");
    assert.equal(cleanMarkdown("[a](https://example.com) [b](javascript:alert(1)) ![c](data:x) [d](https://example.com/(x))"), "[a](https://example.com) b c [d](https://example.com/(x))");
    assert.equal(cleanMarkdown("[[a]](javascript:x) [b [c](javascript:y)"), "[[a]](javascript:x) b [c"); // el texto del enlace llega hasta el primer «]»
  });

  test("instantDay: la zona horaria se cachea (150.000 fechas, rápido), una zona no válida cae a UTC", () => {
    const d = new Date("2026-03-04T23:30:00Z");
    fast(2000, () => { for (let i = 0; i < 150_000; i++) assert.equal(instantDay(d, "Europe/Madrid"), "2026-03-05"); });
    assert.equal(instantDay(d, "No/Existe"), "2026-03-04");
    assert.equal(instantDay(d, "No/Existe"), "2026-03-04");
    assert.equal(instantDay(new Date("x")), null);
  });

  test("CSV con un millón de filas mínimas: se rechaza enseguida y sin gastar memoria", () => {
    const big = `title\n${"a\n".repeat(1_000_000)}`;
    const before = process.memoryUsage().heapUsed;
    const t0 = performance.now();
    assert.throws(() => parseCsvBoard(big, { t }), /demasiadas filas/);
    assert.ok(performance.now() - t0 < 1000, "tardó demasiado");
    assert.ok(process.memoryUsage().heapUsed - before < 100 * 1024 * 1024, "gastó demasiada memoria");
    assert.throws(() => parseCsv(big, undefined, 10), /demasiadas filas/);
    assert.equal(parseCsv("a\nb\nc\n", undefined, 3).length, 3);
    // El tope exacto (6000 filas de tareas) sigue valiendo.
    assert.equal(parseCsvBoard(`title\n${"a\n".repeat(6000)}`, { t }).tasks.length, 6000);
    assert.throws(() => parseCsvBoard(`title\n${"a\n".repeat(6001)}`, { t }), /demasiadas filas/);
  });

  test("CSV: celdas enormes con miles de etiquetas o responsables no son cuadráticas", () => {
    const labels = Array.from({ length: 200_000 }, (_, i) => `e${i}`).join(",");
    const people = Array.from({ length: 200_000 }, (_, i) => `p${i}`).join(",");
    const b = fast(3000, () => csv(`title,labels,assignee\nA,"${labels}","${people}"`));
    assert.equal(b.tasks[0]!.labels.length, 20);
    assert.ok(b.tasks[0]!.assignees.length <= 20);
    assert.ok(b.warnings.some((w) => /199980 etiquetas de tareas sobraban \(máximo 20 por tarea\)/.test(w)));
  });

  test("CSV: más de 20 etiquetas en una tarea se recortan a 20 con aviso; sin repetidas", () => {
    const names = Array.from({ length: 25 }, (_, i) => `et${i}`);
    const b = csv(`title,labels\nA,"${names.join(",")},ET1"\nB,"x,y"`);
    assert.deepEqual(b.tasks[0]!.labels.map((l) => l.name), names.slice(0, 20));
    assert.equal(b.tasks[1]!.labels.length, 2);
    assert.ok(b.warnings.some((w) => /^5 etiquetas de tareas sobraban \(máximo 20 por tarea\)/.test(w)));
  });

  test("CSV: un email con caracteres de control no es un email", () => {
    const b = csv('title,assignee,assignee email\nA,"ana\u0000@example.com","luis\u0001@example.com"\nB,"Eva <eva\u0000@example.com>",');
    for (const p of b.tasks.flatMap((x) => x.assignees)) assert.ok(!p.email || !/[\u0000-\u001f]/.test(p.email), JSON.stringify(p));
    assert.deepEqual(b.tasks[1]!.assignees.map((p) => p.email), [null]);
  });

  test("Trello: 100.000 comentarios en una tarjeta se leen rápido y se recortan al tope", () => {
    const actions = Array.from({ length: 100_000 }, (_, i) => ({
      type: "commentCard", date: new Date(1.7e12 + i * 1000).toISOString(), data: { text: `hola ${i}`, card: { id: "c1" } }, memberCreator: { fullName: "Ana" },
    }));
    const text = JSON.stringify({ name: "x", lists: [{ id: "l1", name: "A", pos: 1 }], cards: [{ id: "c1", name: "t", idList: "l1" }], actions });
    const board = fast(3000, () => parseTrello(text, { t, timeZone: "Europe/Madrid" }));
    const comments = board.tasks[0]!.comments;
    assert.equal(comments.length, 200);
    assert.match(comments[0]!.body, /\n\nhola 99800$/);
    assert.match(comments[199]!.body, /\n\nhola 99999$/);
    assert.ok(board.warnings.some((w) => /^99800 comentarios antiguos no se han importado: de cada tarjeta con más de 200 se guardan los 200 más recientes\.$/.test(w)));
  });

  test("Trello: con más de 200 comentarios en una tarjeta se guardan los 200 más recientes, del más antiguo al más nuevo", () => {
    // Trello los exporta del más nuevo al más antiguo; uno sin fecha cuenta como el más antiguo.
    const dated = Array.from({ length: 250 }, (_, i) => ({
      type: "commentCard", date: new Date(Date.UTC(2026, 0, 1) + i * 60_000).toISOString(), data: { text: `c${i}`, card: { id: "c1" } }, memberCreator: { fullName: "Ana" },
    })).reverse();
    const actions = [...dated, { type: "commentCard", data: { text: "sin fecha", card: { id: "c1" } } }, { type: "commentCard", date: dated[0]!.date, data: { text: "otra", card: { id: "c2" } } }];
    const text = JSON.stringify({ name: "x", lists: [{ id: "l1", name: "A", pos: 1 }], cards: [{ id: "c1", name: "t", idList: "l1" }, { id: "c2", name: "u", idList: "l1" }], actions });
    const board = parseTrello(text, { t });
    const comments = board.tasks[0]!.comments;
    assert.equal(comments.length, 200);
    assert.deepEqual(comments.map((c) => c.body.split("\n\n")[1]), Array.from({ length: 200 }, (_, i) => `c${i + 50}`));
    assert.ok(comments.every((c, i) => i === 0 || c.createdAt!.getTime() > comments[i - 1]!.createdAt!.getTime()));
    assert.equal(board.tasks[1]!.comments.length, 1);
    assert.deepEqual(board.warnings, ["51 comentarios antiguos no se han importado: de cada tarjeta con más de 200 se guardan los 200 más recientes."]);
  });

  test("Trello: muchas tarjetas con comentarios y checklists en cada una se leen rápido", () => {
    const cards = Array.from({ length: 1000 }, (_, i) => ({ id: `c${i}`, name: `t${i}`, idList: "l1", desc: "d".repeat(500) }));
    const actions = Array.from({ length: 150_000 }, (_, i) => ({
      type: "commentCard", date: new Date(1.7e12 + i * 1000).toISOString(), data: { text: `hola ${i}`, card: { id: `c${i % 1000}` } }, memberCreator: { fullName: "Ana" },
    }));
    const checklists = Array.from({ length: 50_000 }, (_, i) => ({ id: `k${i}`, idCard: "c0", name: "L", pos: i, checkItems: [{ name: "x", pos: 1, state: "incomplete" }] }));
    const text = JSON.stringify({ name: "x", lists: [{ id: "l1", name: "A", pos: 1 }], cards, actions, checklists });
    const board = fast(5000, () => parseTrello(text, { t, timeZone: "Europe/Madrid" }));
    assert.equal(board.tasks.length, 1000);
    assert.equal(board.tasks[0]!.subtasks.length, 50);
  });

  test("Trello: más de 20 etiquetas se recortan con aviso, las tarjetas sin título y el recorte de la descripción del tablero también", () => {
    const labels = Array.from({ length: 23 }, (_, i) => ({ id: `b${i}`, name: `et${i}`, color: "blue" }));
    const text = JSON.stringify({
      name: "x", desc: "d".repeat(5000), lists: [{ id: "l1", name: "A", pos: 1 }],
      cards: [{ id: "c1", name: "con", idList: "l1", labels }, { id: "c2", name: "  ", idList: "l1" }, { id: "c3", name: "<b></b>", idList: "l1" }],
    });
    const board = parseTrello(text, { t });
    assert.equal(board.tasks.length, 1);
    assert.equal(board.tasks[0]!.labels.length, 20);
    assert.equal(board.description.length, 2000);
    assert.ok(board.warnings.some((w) => /^2 tarjetas no tenían título/.test(w)));
    assert.ok(board.warnings.some((w) => /^3 etiquetas de tareas sobraban \(máximo 20 por tarea\)/.test(w)));
    assert.ok(board.warnings.includes("1 texto era más largo de lo permitido y se ha recortado."), "el recorte de la descripción del tablero se cuenta antes del aviso");
  });
});
