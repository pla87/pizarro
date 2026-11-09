// Comentarios: menciones legibles en la caja (modelo texto visible + ids aparte) y borradores locales que caducan al día.
import assert from "node:assert/strict";
import { beforeEach, describe, test } from "node:test";
import {
  addMentions, applyTextChange, changedRange, mentionTouching, modelFromRaw, modelToRaw, normalizeModel, replaceRange, sliceToRaw,
} from "../src/lib/mention-edit";
import { extractMentionIds, mentionToken } from "../src/lib/mentions";
import { touchesComments } from "../src/components/board/remoteChange";

const juan = mentionToken("Juan", "cmve09vwn000501s8nyvcf3du");
const ana = mentionToken("Ana Pérez", "ana1");

describe("menciones legibles mientras se escribe", () => {
  test("se ve @Juan sin el id y se guarda en el formato de siempre", () => {
    const raw = `Hola ${juan}, mira esto con ${ana}.`;
    const m = modelFromRaw(raw);
    assert.equal(m.text, "Hola @Juan, mira esto con @Ana Pérez.");
    assert.deepEqual(m.mentions.map((x) => m.text.slice(x.start, x.end)), ["@Juan", "@Ana Pérez"]);
    assert.equal(modelToRaw(m), raw);
    assert.deepEqual(modelFromRaw("sin menciones"), { text: "sin menciones", mentions: [] });
  });

  test("escribir antes, después o al lado de una mención la conserva (desplazada)", () => {
    const m = modelFromRaw(`${juan} hola`);
    assert.equal(modelToRaw(applyTextChange(m, "Ey @Juan hola", 3)), `Ey ${juan} hola`);
    assert.equal(modelToRaw(applyTextChange(m, "@Juan hola!", 11)), `${juan} hola!`);
    // Justo detrás del nombre, sin espacio: la mención sigue entera y la letra queda fuera.
    assert.equal(modelToRaw(applyTextChange(m, "@Juanx hola", 6)), `${juan}x hola`);
  });

  test("borrar o cambiar parte de una mención la deja como texto, sin id huérfano", () => {
    const m = modelFromRaw(`Hola ${juan} y ${ana}`);
    const cut = applyTextChange(m, "Hola @Jua y @Ana Pérez", 9);
    assert.equal(modelToRaw(cut), `Hola @Jua y ${ana}`);
    assert.deepEqual(extractMentionIds(modelToRaw(cut)), ["ana1"]);
    // Escribir DENTRO del nombre (el cursor lo dice, aunque el texto sea el mismo que escribirlo detrás).
    const ann = modelFromRaw(mentionToken("Ann", "x1"));
    assert.equal(modelToRaw(applyTextChange(ann, "@Annn", 4)), "@Annn");
    assert.equal(modelToRaw(applyTextChange(ann, "@Annn", 5)), `${mentionToken("Ann", "x1")}n`);
    // Seleccionar un trozo que pisa la mención y escribir encima.
    assert.equal(modelToRaw(applyTextChange(m, "Hola XY y @Ana Pérez", 7)), `Hola XY y ${ana}`);
    // Vaciar la caja.
    assert.deepEqual(applyTextChange(m, "", 0).mentions, []);
  });

  test("tramo cambiado: el cursor resuelve los casos ambiguos", () => {
    assert.deepEqual(changedRange("aa", "aaa", 1), { from: 0, toPrev: 0, toNext: 1 });
    assert.deepEqual(changedRange("aa", "aaa", 3), { from: 2, toPrev: 2, toNext: 3 });
    assert.deepEqual(changedRange("abc", "ac", 1), { from: 1, toPrev: 2, toNext: 1 });
  });

  test("elegir a alguien o pegar texto con menciones las coloca en su sitio", () => {
    const m = modelFromRaw("Hola @ju");
    const r = replaceRange(m, 5, 8, `${juan} `);
    assert.equal(r.model.text, "Hola @Juan ");
    assert.equal(r.caret, 11);
    assert.equal(modelToRaw(r.model), `Hola ${juan} `);
    // Como lo haría execCommand: primero cambia el texto y luego se añaden las menciones esperadas.
    const typed = applyTextChange(m, "Hola @Juan ", 11);
    const placed = addMentions(typed, [{ start: 5, end: 10, id: "j", name: "Juan" }]);
    assert.equal(modelToRaw(placed), `Hola ${mentionToken("Juan", "j")} `);
    // Si el texto no coincide (p. ej. el navegador recortó lo pegado), no se inventa la mención.
    assert.deepEqual(addMentions(typed, [{ start: 5, end: 10, id: "j", name: "Juana" }]).mentions, []);
  });

  test("copiar un trozo conserva solo las menciones enteras", () => {
    const m = modelFromRaw(`a ${juan} b ${ana} c`);
    assert.equal(sliceToRaw(m, 0, 9), `a ${juan} b`);
    assert.equal(sliceToRaw(m, 4, 20), `uan b ${ana}`);
  });

  test("Retroceso al final y Supr al principio encuentran la mención entera", () => {
    const m = modelFromRaw(`x ${juan} y`);
    assert.equal(mentionTouching(m, 7, "backward")?.id, "cmve09vwn000501s8nyvcf3du");
    assert.equal(mentionTouching(m, 2, "forward")?.name, "Juan");
    assert.equal(mentionTouching(m, 6, "backward"), undefined);
  });

  test("lo escrito con forma de mención guardada pasa a ser mención", () => {
    const m = applyTextChange(modelFromRaw(""), `hola ${juan}`, 0);
    const n = normalizeModel(m);
    assert.equal(n.text, "hola @Juan");
    assert.equal(n.mentions.length, 1);
    const plain = modelFromRaw("nada raro");
    assert.equal(normalizeModel(plain), plain);
  });
});

describe("refresco en vivo de los comentarios", () => {
  test("solo los cambios de comentarios de esta tarea (o deshacer, que no dice cuál)", () => {
    assert.equal(touchesComments({ action: "tasks.editComment", taskId: "t1", userId: "u" }, "t1"), true);
    assert.equal(touchesComments({ action: "tasks.addComment", taskId: "t2", userId: "u" }, "t1"), false);
    assert.equal(touchesComments({ action: "tasks.moveTask", taskId: "t1", userId: "u" }, "t1"), false);
    assert.equal(touchesComments({ action: "undo.undoLast", taskId: null, userId: "u" }, "t1"), true);
    assert.equal(touchesComments({ action: "tasks.moveTasks", taskId: null, userId: "u" }, "t1"), false);
  });
});

describe("borradores de comentarios", () => {
  const store = new Map<string, string>();
  const ls = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
    key: (i: number) => [...store.keys()][i] ?? null,
    get length() {
      return store.size;
    },
  };
  // Object.keys(localStorage) lista las claves: se imita con un Proxy.
  const proxy = new Proxy(ls, { ownKeys: () => [...store.keys()], getOwnPropertyDescriptor: (_t, k) => (store.has(k as string) ? { enumerable: true, configurable: true, value: store.get(k as string) } : undefined) });
  (globalThis as unknown as { localStorage: unknown }).localStorage = proxy;
  beforeEach(() => store.clear());

  test("por usuario y tarea; vacío o solo espacios lo borra", async () => {
    const { readCommentDraft, saveCommentDraft, commentDraftKey } = await import("../src/components/board/draft-storage");
    saveCommentDraft("u1", "t1", { text: `Hola ${juan}`, replyTo: { id: "c1", authorName: "Ana", body: "x".repeat(500) } });
    const d = readCommentDraft("u1", "t1");
    assert.equal(d?.text, `Hola ${juan}`);
    assert.equal(d?.replyTo?.id, "c1");
    assert.equal(d?.replyTo?.body.length, 200, "solo lo justo para «Respondiendo a…»");
    assert.equal(readCommentDraft("u2", "t1"), null, "otro usuario no lo ve");
    assert.equal(readCommentDraft("u1", "t2"), null, "otra tarea tampoco");
    saveCommentDraft("u1", "t1", { text: "   " });
    assert.equal(store.has(commentDraftKey("u1", "t1")), false);
  });

  test("caduca al día y al cargar se limpian los caducados de todas las tareas", async () => {
    const { readCommentDraft, purgeExpiredCommentDrafts, commentDraftKey, COMMENT_DRAFT_MAX_AGE_MS } = await import("../src/components/board/draft-storage");
    const now = Date.now();
    store.set(commentDraftKey("u1", "viejo"), JSON.stringify({ at: now - COMMENT_DRAFT_MAX_AGE_MS - 1000, value: { text: "ayer" } }));
    store.set(commentDraftKey("u1", "reciente"), JSON.stringify({ at: now - 60_000, value: { text: "hace un minuto" } }));
    store.set(commentDraftKey("u1", "roto"), "{no es json");
    store.set("pz-draft-new:u1:p1", JSON.stringify({ at: now - COMMENT_DRAFT_MAX_AGE_MS - 1000, value: {} }));
    assert.equal(readCommentDraft("u1", "viejo"), null);
    assert.equal(store.has(commentDraftKey("u1", "viejo")), false, "leer uno caducado lo borra");
    store.set(commentDraftKey("u1", "viejo"), JSON.stringify({ at: now - COMMENT_DRAFT_MAX_AGE_MS - 1000, value: { text: "ayer" } }));
    purgeExpiredCommentDrafts(now);
    assert.deepEqual([...store.keys()].sort(), [commentDraftKey("u1", "reciente"), "pz-draft-new:u1:p1"].sort(), "solo borra comentarios caducados o ilegibles");
    assert.equal(readCommentDraft("u1", "reciente")?.text, "hace un minuto");
  });
});
