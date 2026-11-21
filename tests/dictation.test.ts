import assert from "node:assert/strict";
import { test } from "node:test";
import { capitalizeFirst, dictationChunk, dictationLang, insertDictation, startsSentence } from "../src/lib/dictation";
import { screenWakeLock } from "../src/lib/wake-lock";

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
  assert.equal(dictationLang("en-US"), "en-US");
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

/** `navigator.wakeLock` de mentira: cada petición queda pendiente hasta `grant()` (o `deny()`). */
function fakeWakeLock() {
  const sentinels: { released: boolean; release(): Promise<void> }[] = [];
  const waiting: { resolve: (s: (typeof sentinels)[number]) => void; reject: (e: Error) => void }[] = [];
  const api = {
    request(type: "screen") {
      assert.equal(type, "screen");
      return new Promise<(typeof sentinels)[number]>((resolve, reject) => waiting.push({ resolve, reject }));
    },
  };
  const tick = () => new Promise((r) => setImmediate(r));
  return {
    api,
    sentinels,
    get requests() {
      return waiting.length;
    },
    async grant() {
      const s = { released: false, async release() { s.released = true; } };
      sentinels.push(s);
      waiting.shift()!.resolve(s);
      await tick();
      return s;
    },
    async deny() {
      waiting.shift()!.reject(new Error("NotAllowedError"));
      await tick();
    },
    /** El navegador lo suelta solo (pestaña oculta). */
    hide() {
      for (const s of sentinels) s.released = true;
    },
  };
}

test("pantalla encendida al dictar: se pide al empezar y se suelta al parar", async () => {
  const fake = fakeWakeLock();
  const lock = screenWakeLock(() => fake.api);
  lock.hold();
  assert.equal(fake.requests, 1);
  lock.hold(); // ya pidiéndose: no pide otro
  assert.equal(fake.requests, 1);
  const s = await fake.grant();
  assert.equal(s.released, false);
  lock.resume(); // activo: no pide otro
  assert.equal(fake.requests, 0);
  lock.release();
  assert.equal(s.released, true);
});

test("pantalla encendida: soltado antes de que llegue, se suelta en cuanto llega", async () => {
  const fake = fakeWakeLock();
  const lock = screenWakeLock(() => fake.api);
  lock.hold();
  lock.release();
  const s = await fake.grant();
  assert.equal(s.released, true);
  lock.resume(); // ya no se quiere: nada
  assert.equal(fake.requests, 0);
});

test("pantalla encendida: al volver a la pestaña se pide de nuevo, solo si sigue dictando", async () => {
  const fake = fakeWakeLock();
  const lock = screenWakeLock(() => fake.api);
  lock.hold();
  await fake.grant();
  fake.hide();
  lock.resume();
  assert.equal(fake.requests, 1);
  const again = await fake.grant();
  assert.equal(again.released, false);
  lock.release();
  assert.equal(again.released, true);
  fake.hide();
  lock.resume();
  assert.equal(fake.requests, 0);
});

test("pantalla encendida: sin Wake Lock o si el navegador lo niega, sigue sin errores", async () => {
  for (const api of [() => undefined, () => null, () => ({}) as never, () => { throw new Error("x"); }]) {
    const lock = screenWakeLock(api);
    lock.hold();
    lock.resume();
    lock.release();
  }
  const throwing = screenWakeLock(() => ({ request: () => { throw new Error("SecurityError"); } }));
  throwing.hold();
  throwing.release();
  const fake = fakeWakeLock();
  const lock = screenWakeLock(() => fake.api);
  lock.hold();
  await fake.deny();
  lock.resume(); // se puede volver a intentar al volver a la pestaña
  assert.equal(fake.requests, 1);
  await fake.grant();
  lock.release();
  assert.equal(fake.sentinels[0]!.released, true);
});
