import assert from "node:assert/strict";
import { test } from "node:test";
import { makeT } from "../src/i18n/core";
import { checklistMarkdown, groupChecklist, missingSubtasksText, type ChecklistItem } from "../src/lib/checklist";
import { buildIcs, escapeIcsText, foldIcsLine, markdownToPlain } from "../src/lib/ics";

test("escapeIcsText escapa barra, punto y coma, coma y saltos de línea", () => {
  assert.equal(escapeIcsText("a;b,c\\d\ne\r\nf"), "a\\;b\\,c\\\\d\\ne\\nf");
});

test("foldIcsLine pliega a 75 octetos sin partir caracteres multibyte", () => {
  const long = "SUMMARY:" + "ñ".repeat(100);
  const folded = foldIcsLine(long);
  const lines = folded.split("\r\n");
  assert.ok(lines.length > 1);
  lines.forEach((l, i) => {
    assert.ok(Buffer.byteLength(l, "utf8") <= 75, `línea ${i} demasiado larga`);
    if (i > 0) assert.ok(l.startsWith(" "));
  });
  // Al desplegar (quitar CRLF + espacio) se recupera el original.
  assert.equal(folded.replace(/\r\n /g, ""), long);
  assert.equal(foldIcsLine("corta"), "corta");
});

test("buildIcs: eventos de día completo con CRLF, escape y fin exclusivo", () => {
  const ics = buildIcs({
    name: "Agenda, equipo",
    now: new Date("2026-10-29T10:00:00Z"),
    events: [
      { uid: "t1@pizarro", date: "2026-12-31", summary: "Cerrar año; revisar", description: "Línea 1\nLínea 2, con coma", url: "https://example.com/p/1?task=t1" },
      { uid: "t2@pizarro", date: "2026-11-05", summary: "Sin descripción" },
    ],
  });
  assert.ok(ics.endsWith("END:VCALENDAR\r\n"));
  assert.ok(!/[^\r]\n/.test(ics), "todos los saltos son CRLF");
  assert.match(ics, /^BEGIN:VCALENDAR\r\nVERSION:2\.0\r\n/);
  assert.match(ics, /X-WR-CALNAME:Agenda\\, equipo\r\n/);
  assert.match(ics, /DTSTAMP:20261029T100000Z\r\n/);
  assert.match(ics, /DTSTART;VALUE=DATE:20261231\r\nDTEND;VALUE=DATE:20270101\r\n/);
  assert.match(ics, /SUMMARY:Cerrar año\\; revisar\r\n/);
  assert.match(ics, /DESCRIPTION:Línea 1\\nLínea 2\\, con coma\r\n/);
  assert.match(ics, /URL:https:\/\/example\.com\/p\/1\?task=t1\r\n/);
  assert.equal((ics.match(/BEGIN:VEVENT/g) ?? []).length, 2);
  // El segundo evento no lleva DESCRIPTION ni URL.
  const second = ics.split("BEGIN:VEVENT")[2]!;
  assert.ok(!second.includes("DESCRIPTION") && !second.includes("URL:"));
});

test("markdownToPlain deja texto plano legible", () => {
  const md = "## Título\n**negrita** y _cursiva_ con [enlace](https://example.com) y @[Ana](user:abc123)\n- uno\n- [ ] dos\n`código`";
  assert.equal(markdownToPlain(md), "Título\nnegrita y cursiva con enlace (https://example.com) y @Ana\n- uno\n[ ] dos\ncódigo");
});

const item = (id: string, taskId: string, taskTitle: string, kindId: string, kindName: string, done = false): ChecklistItem => ({ id, title: `Sub ${id}`, done, taskId, taskTitle, kindId, kindName });
const items = [
  item("1", "a", "Tarjeta A", "k2", "Mejora"),
  item("2", "a", "Tarjeta A", "k2", "Mejora", true),
  item("3", "b", "Tarjeta B", "k1", "Error"),
  item("4", "c", "Tarjeta C", "k2", "Mejora"),
];

test("groupChecklist por tarjeta conserva el orden de la columna", () => {
  const g = groupChecklist(items, "card");
  assert.deepEqual(g.map((x) => [x.label, x.items.length]), [["Tarjeta A", 2], ["Tarjeta B", 1], ["Tarjeta C", 1]]);
});

test("groupChecklist por tipo ordena los tipos alfabéticamente", () => {
  const g = groupChecklist(items, "kind");
  assert.deepEqual(g.map((x) => [x.label, x.items.map((i) => i.id)]), [["Error", ["3"]], ["Mejora", ["1", "2", "4"]]]);
});

test("checklistMarkdown genera casillas y, por tipo, la tarjeta de cada elemento", () => {
  assert.equal(checklistMarkdown(groupChecklist(items.slice(0, 3), "card"), "card", "Revisión"), "# Revisión\n\n## Tarjeta A\n- [ ] Sub 1\n- [x] Sub 2\n\n## Tarjeta B\n- [ ] Sub 3\n");
  assert.equal(checklistMarkdown(groupChecklist(items.slice(2, 4), "kind"), "kind"), "## Error\n- [ ] Sub 3 (Tarjeta B)\n\n## Mejora\n- [ ] Sub 4 (Tarjeta C)\n");
});

test("missingSubtasksText cuenta y resume", () => {
  const t = makeT("es");
  assert.equal(missingSubtasksText(["A"], t), "Falta 1 subtarea: A");
  assert.equal(missingSubtasksText(["A", "B"], t), "Faltan 2 subtareas: A, B");
  assert.equal(missingSubtasksText(["1", "2", "3", "4", "5", "6", "7"], t), "Faltan 7 subtareas: 1, 2, 3, 4, 5 y 2 más");
});
