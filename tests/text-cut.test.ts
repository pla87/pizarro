// Recortes de texto de usuario (avisos, emails, Telegram, nombres): nunca parten un emoji ni dejan medio par sustituto.
import assert from "node:assert/strict";
import { test } from "node:test";
import { cutText, ellipsize } from "../src/lib/graphemes";
import { excerpt } from "../src/lib/mentions";
import { parseSubtaskLines } from "../src/lib/kinds-special";
import { telegramNoticeText } from "../src/lib/messaging-core";
import { esT } from "../src/i18n/shared";

/** ¿Hay algún par sustituto suelto (la mitad de un emoji)? */
const loneSurrogate = (s: string) => /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(s);

test("cutText: como mucho max unidades, sin partir emojis ni secuencias unidas", () => {
  assert.equal(cutText("hola", 10), "hola");
  assert.equal(cutText("abcdef", 3), "abc");
  // «a» + 😀 (2 unidades): con 2 no cabe el emoji entero y se queda fuera.
  assert.equal(cutText("a😀b", 2), "a");
  assert.equal(cutText("a😀b", 3), "a😀");
  // Familia (11 unidades) y bandera (4): enteras o nada.
  const family = "👨‍👩‍👧‍👦";
  assert.equal(cutText(`x${family}`, 6), "x");
  assert.equal(cutText(`x${family}y`, 1 + family.length), `x${family}`);
  assert.equal(cutText("🇪🇸🇪🇸", 6), "🇪🇸");
});

test("ellipsize: deja sitio para «…» y no pasa de max", () => {
  assert.equal(ellipsize("corto", 10), "corto");
  const r = ellipsize(`${"a".repeat(8)}😀😀`, 10);
  assert.equal(r, `${"a".repeat(8)}…`);
  assert.ok(r.length <= 10);
});

test("excerpt de avisos y emails: un emoji en el borde del recorte no se parte", () => {
  for (let n = 0; n < 4; n++) {
    const text = `${"x".repeat(178 + n)}😀😀😀 fin`;
    const out = excerpt(text);
    assert.ok(out.endsWith("…"), out);
    assert.ok(out.length <= 180);
    assert.equal(loneSurrogate(out), false, `n=${n}`);
  }
});

test("Telegram: el título, el proyecto y el extracto se recortan sin partir emojis", () => {
  const title = `${"t".repeat(118)}😀😀`;
  const html = telegramNoticeText(
    { type: "MENTION", actorName: "Ana", taskTitle: title, projectName: `${"p".repeat(99)}😀😀`, excerpt: `${"b".repeat(299)}😀😀`, url: "https://example.com/t" } as never,
    esT,
  );
  assert.equal(loneSurrogate(String(html)), false);
});

test("subtareas de un tipo: una línea larga se corta sin partir un emoji", () => {
  const [line] = parseSubtaskLines(`${"s".repeat(199)}😀😀`);
  assert.equal(loneSurrogate(line!), false);
});
