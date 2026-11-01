import assert from "node:assert/strict";
import { test } from "node:test";
import { capitalizeFirst, dictationChunk, dictationLang, insertDictation, startsSentence } from "../src/lib/dictation";

test("empieza frase: principio, línea nueva, lista y tras un punto", () => {
  assert.equal(startsSentence(""), true);
  assert.equal(startsSentence("Hola. "), true);
  assert.equal(startsSentence("¿Qué tal? "), true);
  assert.equal(startsSentence("uno\n"), true);
  assert.equal(startsSentence("uno\n- "), true);
  assert.equal(startsSentence("uno\n1. "), true);
  assert.equal(startsSentence("hola "), false);
  assert.equal(startsSentence("hola, "), false);
});

test("capitalizeFirst salta signos y respeta acentos", () => {
  assert.equal(capitalizeFirst("¿qué tal?"), "¿Qué tal?");
  assert.equal(capitalizeFirst("épico"), "Épico");
  assert.equal(capitalizeFirst("123"), "123");
});

test("inserción en campo vacío: mayúscula, sin espacios", () => {
  assert.deepEqual(insertDictation("", 0, 0, "  revisar la factura "), { value: "Revisar la factura", start: 18, end: 18 });
  assert.equal(insertDictation("abc", 3, 3, "   "), null);
});

test("después de una palabra: espacio y minúscula; después de un punto: mayúscula", () => {
  assert.equal(insertDictation("Revisar", 7, 7, "la factura")?.value, "Revisar la factura");
  assert.equal(insertDictation("Hola.", 5, 5, "adiós")?.value, "Hola. Adiós");
  assert.equal(insertDictation("Hola. ", 6, 6, "adiós")?.value, "Hola. Adiós");
  assert.equal(insertDictation("Hola\n", 5, 5, "adiós")?.value, "Hola\nAdiós");
});

test("en mitad del texto: espacio por la derecha y cursor antes de él", () => {
  const r = insertDictation("Revisar factura", 8, 8, "la")!;
  assert.equal(r.value, "Revisar la factura");
  assert.equal(r.start, 10);
  assert.equal(insertDictation("uno, tres", 3, 3, "dos")?.value, "uno dos, tres");
});

test("reemplaza la selección", () => {
  assert.equal(insertDictation("Hola mundo feo", 10, 14, "bonito")?.value, "Hola mundo bonito");
});

test("signos al principio del trozo se pegan a la palabra anterior; tras apertura no hay espacio", () => {
  assert.equal(dictationChunk("hola", "", ", mundo"), ", mundo");
  assert.equal(dictationChunk("(", "", "nota"), "nota");
  assert.equal(dictationChunk("hola ", "", "mundo"), "mundo");
});

test("idioma por defecto según la interfaz", () => {
  assert.equal(dictationLang("es-ES"), "es-ES");
  assert.equal(dictationLang("en-GB"), "en-US");
});

test("comillas rectas, guion y barra solo abren al principio o tras un espacio", () => {
  assert.equal(dictationChunk('dijo "', "", "hola"), "hola"); // apertura: pegado
  assert.equal(dictationChunk('"', "", "hola"), "hola");
  assert.equal(dictationChunk('dijo "hola"', "", "y adiós"), " y adiós"); // cierre: con espacio
  assert.equal(dictationChunk("a-", "", "b"), " b");
  assert.equal(dictationChunk("uno /", "", "dos"), "dos");
  assert.equal(dictationChunk("rojo/", "", "azul"), " azul");
});

test("modo líneas: cada trozo en su línea", () => {
  assert.equal(insertDictation("", 0, 0, "comprar pan", true)?.value, "Comprar pan");
  assert.equal(insertDictation("Comprar pan", 11, 11, "llamar a Ana", true)?.value, "Comprar pan\nLlamar a Ana");
  assert.equal(insertDictation("Uno\nTres", 3, 3, "dos", true)?.value, "Uno\nDos\nTres");
});
