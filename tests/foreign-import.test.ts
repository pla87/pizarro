// Importar desde otros Kanban: lector del JSON de Trello, lector del CSV genérico (separadores, comillas, BOM, cabeceras de
// Asana y Jira…), detección de formato y saneado de textos. Las pruebas con base de datos están en tests/db/foreign-import.test.ts.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test, describe } from "node:test";
import { makeT } from "../src/i18n/core";
import { detectDelimiter, mapHeaders, parseCsv, parseCsvBoard } from "../src/lib/foreign-import/csv";
import { assertBoardLimits, decodeText, parseForeign, sniffFormat } from "../src/lib/foreign-import/parse";
import { cleanMarkdown, parseDay } from "../src/lib/foreign-import/text";
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
    assert.ok(board.warnings.some((w) => /1 archivos adjuntos subidos a Trello no se han importado/.test(w)));
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

  test("exportación de Jira: Summary, Issue key, Status, Priority, Due Date, Description y varias columnas «Labels»", () => {
    const b = csv(
      "Summary,Issue key,Issue id,Issue Type,Status,Priority,Assignee,Due Date,Labels,Labels,Description\n" +
        'Arreglar el login,PRJ-12,10012,Bug,In Progress,Highest,jperez@example.com,15/Jan/26 10:20 AM,auth,urgente,"Falla con ""SSO"""\n' +
        "Documentar la API,PRJ-13,10013,Task,To Do,Low,,,docs,,\n",
    );
    assert.deepEqual(b.columns, ["In Progress", "To Do"]);
    const [a, d] = b.tasks;
    assert.equal(a!.title, "Arreglar el login");
    assert.equal(a!.priority, "URGENTE");
    assert.equal(a!.due, "2026-01-15");
    assert.deepEqual(a!.labels.map((l) => l.name), ["auth", "urgente"]);
    assert.deepEqual(a!.assignees, [{ email: "jperez@example.com", name: null }]);
    assert.equal(a!.description, 'Falla con "SSO"\n\n_Referencia original: PRJ-12_');
    assert.equal(d!.priority, "BAJA");
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
    assert.ok(b.warnings.some((w) => /1 prioridades/.test(w)));
    assert.ok(b.warnings.some((w) => /1 filas no tenían título/.test(w)));
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

  test("assertBoardLimits acepta un tablero normal", () => {
    assert.doesNotThrow(() => assertBoardLimits(parseForeign(trelloText, "trello", { t })));
  });
});
