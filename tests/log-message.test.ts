// Mensajes del registro (Administración → Logs) en el idioma de quien lee: toda escritura de un evento lleva su plantilla
// traducible (`label` en logEvent, LOG_LABEL_KEY en las filas que se escriben directamente) con sus textos en el
// diccionario, y las listas («título y tipo») se unen en cada idioma.
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { makeT } from "../src/i18n/core";
import { EN } from "../src/i18n/en";
import { andList, renderLabel, renderLabelEs } from "../src/lib/undo-label";

const ROOT = path.join(import.meta.dirname, "..");
/** Marca de una llamada que puede ir sin plantilla (con su motivo en el mismo comentario). */
const MARKER = "log-sin-plantilla:";

function sources(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name !== "generated" && e.name !== "node_modules") out.push(...sources(p));
    } else if (/\.(ts|tsx|mts|mjs)$/.test(e.name)) out.push(p);
  }
  return out;
}

/** Final del paréntesis, llave o corchete que se abre en `open` (sin contar los de los textos). */
function closing(s: string, open: number): number {
  let depth = 0;
  for (let i = open; i < s.length; i++) {
    const c = s[i]!;
    if (c === '"' || c === "'" || c === "`") {
      for (i++; i < s.length && s[i] !== c; i++) if (s[i] === "\\") i++;
      continue;
    }
    if ("([{".includes(c)) depth++;
    else if (")]}".includes(c) && --depth === 0) return i;
  }
  return s.length - 1;
}

/** Cada llamada `<name>(…)` de los ficheros, con su texto y los dos renglones anteriores (para la marca). */
function calls(name: string): { where: string; text: string; before: string }[] {
  const out: { where: string; text: string; before: string }[] = [];
  const re = new RegExp(`(?<![\\w])${name.replace(".", "\\.")}\\(`, "g");
  for (const file of [...sources(path.join(ROOT, "src")), ...sources(path.join(ROOT, "scripts"))]) {
    const s = readFileSync(file, "utf8");
    for (const m of s.matchAll(re)) {
      const before = s.slice(0, m.index);
      if (/function\s+$/.test(before) || /["'`]$/.test(before)) continue; // la definición, o el nombre dentro de un texto
      const open = m.index + m[0].length - 1;
      const lineStart = before.lastIndexOf("\n");
      out.push({
        where: `${path.relative(ROOT, file)}:${before.split("\n").length}`,
        text: s.slice(m.index, closing(s, open) + 1),
        before: s.slice(before.lastIndexOf("\n", before.lastIndexOf("\n", lineStart - 1) - 1) + 1, m.index),
      });
    }
  }
  return out;
}

/** Textos entre comillas dobles de las expresiones `k: …` de una llamada (hasta la coma o la llave que las cierra). */
function templateLiterals(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/(?<![\w$])k:\s*/g)) {
    let depth = 0;
    let i = m.index + m[0].length;
    const start = i;
    for (; i < text.length; i++) {
      const c = text[i]!;
      if (c === '"' || c === "'" || c === "`") {
        for (i++; i < text.length && text[i] !== c; i++) if (text[i] === "\\") i++;
        continue;
      }
      if ("([{".includes(c)) depth++;
      else if (")]}".includes(c)) {
        if (depth === 0) break;
        depth--;
      } else if (c === "," && depth === 0) break;
    }
    const expr = text.slice(start, i);
    assert.ok(!/`[^`]*\$\{/.test(expr), `plantilla con \${…}: los datos van en p, no en el texto (${expr.slice(0, 80)})`);
    // Textos uno tras otro; los de las condiciones (`purpose === "INVITE" ? … : …`) no son plantillas.
    for (let j = 0; j < expr.length; j++) {
      if (expr[j] !== '"') continue;
      let end = j + 1;
      while (end < expr.length && expr[end] !== '"') end += expr[end] === "\\" ? 2 : 1;
      const compared = /[=!]==\s*$/.test(expr.slice(0, j)) || /^\s*[=!]==/.test(expr.slice(end + 1));
      if (!compared) out.push(JSON.parse(expr.slice(j, end + 1)) as string);
      j = end;
    }
  }
  return out;
}

test("todo logEvent lleva su plantilla traducible (`label`, sin `message` de texto libre) salvo los marcados", () => {
  const found = calls("logEvent");
  assert.ok(found.length > 120, `solo se encontraron ${found.length} llamadas: ¿ha cambiado la forma de llamarlo?`);
  const bad = found.filter((c) => {
    if (c.before.includes(MARKER) || c.text.includes(MARKER)) return false;
    return !/[{,\s]label\s*[:,}]/.test(c.text) || /[{,\s]message\s*:/.test(c.text);
  });
  assert.deepEqual(bad.map((c) => c.where), [], `Sin plantilla (usa label: { k: "texto con {variables}", p: { … } } o marca la excepción con «// ${MARKER} motivo»)`);
});

test("las filas del registro que se escriben sin logEvent (arranque, enlace de restablecimiento) llevan la plantilla", () => {
  const direct = calls("appLog.create").filter((c) => !c.where.startsWith("src/lib/log.ts"));
  assert.ok(direct.length >= 2);
  for (const c of direct) assert.ok(c.text.includes("LOG_LABEL_KEY") || c.before.includes(MARKER), `${c.where}: sin LOG_LABEL_KEY en los detalles`);
});

test("los textos fijos de las plantillas del registro tienen traducción al inglés", () => {
  const missing: string[] = [];
  let checked = 0;
  for (const c of [...calls("logEvent"), ...calls("appLog.create")]) {
    for (const k of templateLiterals(c.text)) {
      checked++;
      if (k && !(k in EN)) missing.push(`${c.where}: ${k}`);
    }
  }
  assert.ok(checked > 150, `solo ${checked} textos: ¿ha cambiado la forma de escribir las plantillas?`);
  assert.deepEqual(missing, []);
});

/** Primer argumento de una llamada `name(…)` (hasta la coma o el paréntesis que lo cierran, sin contar los de los textos). */
function firstArgument(text: string): { arg: string; more: boolean } {
  let depth = 0;
  const start = text.indexOf("(") + 1;
  for (let i = start; i < text.length; i++) {
    const c = text[i]!;
    if (c === '"' || c === "'" || c === "`") {
      for (i++; i < text.length && text[i] !== c; i++) if (text[i] === "\\") i++;
      continue;
    }
    if ("([{".includes(c)) depth++;
    else if (")]}".includes(c)) {
      if (depth === 0) return { arg: text.slice(start, i), more: false };
      depth--;
    } else if (c === "," && depth === 0) return { arg: text.slice(start, i), more: text.slice(i + 1).trim() !== ")" };
  }
  return { arg: text.slice(start), more: false };
}

/** Textos entre comillas dobles de una expresión, sin los de las condiciones (`kind === "privacy" ? … : …`). */
function quoted(expr: string): string[] {
  const out: string[] = [];
  for (let j = 0; j < expr.length; j++) {
    if (expr[j] !== '"') continue;
    let end = j + 1;
    while (end < expr.length && expr[end] !== '"') end += expr[end] === "\\" ? 2 : 1;
    const compared = /[=!]==\s*$/.test(expr.slice(0, j)) || /^\s*[=!]==/.test(expr.slice(end + 1));
    if (!compared) out.push(JSON.parse(expr.slice(j, end + 1)) as string);
    j = end;
  }
  return out;
}

// describeAction deja el mensaje de la acción en Logs: con un texto ya montado («Dio de alta a «Ana»») la página no puede
// traducirlo. El texto es una plantilla («Dio de alta a «{name}»», { name }) o un texto fijo del diccionario.
test("describeAction recibe una plantilla o un texto fijo (sin `${…}`, sin sumar textos ni pasar uno ya montado) salvo los marcados", () => {
  const found = calls("describeAction").filter((c) => !c.where.startsWith("src/lib/action-context.ts"));
  assert.ok(found.length > 60, `solo se encontraron ${found.length} llamadas: ¿ha cambiado la forma de llamarlo?`);
  const bad = found.filter((c) => {
    if (c.before.includes(MARKER) || c.text.includes(MARKER)) return false;
    const { arg, more } = firstArgument(c.text);
    // Sin los textos entre comillas dobles, lo que queda no puede ser una plantilla de JS ni una suma de textos.
    const code = arg.replace(/"(?:[^"\\]|\\.)*"/g, '""');
    if (/[`']/.test(code) || /\+/.test(code)) return true;
    // Una variable sola sin parámetros (`describeAction(message)`) es un texto ya montado.
    return !more && !/"/.test(arg);
  });
  assert.deepEqual(bad.map((c) => c.where), [], `Texto libre en describeAction (usa describeAction("texto con {variables}", { … }) o marca la excepción con «// ${MARKER} motivo»)`);
});

test("los textos de describeAction (y sus plantillas anidadas) tienen traducción al inglés", () => {
  const missing: string[] = [];
  let checked = 0;
  for (const c of calls("describeAction").filter((x) => !x.where.startsWith("src/lib/action-context.ts"))) {
    if (c.before.includes(MARKER) || c.text.includes(MARKER)) continue;
    for (const k of [...quoted(firstArgument(c.text).arg), ...templateLiterals(c.text)]) {
      checked++;
      if (k && !(k in EN)) missing.push(`${c.where}: ${k}`);
    }
  }
  assert.ok(checked > 80, `solo ${checked} textos: ¿ha cambiado la forma de escribirlos?`);
  assert.deepEqual(missing, []);
});

test("deshacer en Logs: «Deshizo: …» con la etiqueta guardada anidada, en el idioma de quien lee", () => {
  const en = makeT("en");
  const label = { k: "Deshizo: {action}{parts}", p: { action: { k: "Modificó «{title}»: {changes}", p: { title: "Obra", changes: andList([{ k: "título" }, { k: "tipo" }]) } }, parts: { k: " ({n} partes ya no existían)", p: { n: 2 } } } };
  assert.equal(renderLabelEs(label), "Deshizo: Modificó «Obra»: título y tipo (2 partes ya no existían)");
  assert.equal(renderLabel(label, en), "Undid: Edited “Obra”: title and type (2 parts no longer existed)");
  // Las entradas de versiones antiguas guardan texto plano: sale tal cual.
  assert.equal(renderLabel({ k: "Rehízo: {action}{parts}", p: { action: "Movió «X» de A a B", parts: "" } }, en), "Redid: Movió «X» de A a B");
});

test("listas: «título», «título y tipo», «título, tipo y color» (en inglés con «and» y comas)", () => {
  const en = makeT("en");
  const fields = [{ k: "título" }, { k: "tipo" }, { k: "color" }];
  const edited = (n: number) => ({ k: "Modificó «{title}»: {changes}", p: { title: "Obra: casa", changes: andList(fields.slice(0, n)) } });
  assert.equal(renderLabelEs(edited(1)), "Modificó «Obra: casa»: título");
  assert.equal(renderLabel(edited(1), en), "Edited “Obra: casa”: title");
  assert.equal(renderLabelEs(edited(2)), "Modificó «Obra: casa»: título y tipo");
  assert.equal(renderLabel(edited(2), en), "Edited “Obra: casa”: title and type");
  assert.equal(renderLabelEs(edited(3)), "Modificó «Obra: casa»: título, tipo y color");
  assert.equal(renderLabel(edited(3), en), "Edited “Obra: casa”: title, type and color");
  assert.deepEqual(andList([]), { k: "" });
});
