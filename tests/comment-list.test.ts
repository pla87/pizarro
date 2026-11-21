// Lista de comentarios del detalle abierto: fusión por fecha e id sin repetidos y cursor del refresco en vivo.
import assert from "node:assert/strict";
import { test } from "node:test";
import { mergeComments, refreshCursor } from "../src/components/board/comment-list";
import { applyFirstPage } from "../src/lib/comment-refresh";
import type { CommentInfo } from "../src/lib/types";

const c = (id: string, at: string, body = id): CommentInfo => ({ id, body, createdAt: `2026-11-12T10:00:${at}.000Z`, authorId: "u", authorName: "U", parentId: null });

test("mergeComments: orden por fecha y, a igual fecha, por id; sin repetidos (gana la última versión)", () => {
  const mine = c("b1", "05");
  // El propio se añadió al final, pero otra persona comentó antes (llega después en el refresco).
  const merged = mergeComments([c("x", "01"), mine], [c("c1", "03"), c("e1", "05"), c("b1", "05", "editado")]);
  assert.deepEqual(merged.map((m) => m.id), ["x", "c1", "b1", "e1"]);
  assert.equal(merged.find((m) => m.id === "b1")!.body, "editado");
  assert.deepEqual(mergeComments([], []), []);
});

test("refreshCursor: nunca un comentario propio aún sin listar (otra persona pudo comentar justo antes)", () => {
  const unlisted = new Set(["b1"]);
  // Sin comentarios del servidor (la tarea no tenía): desde el principio, no desde el nuestro.
  assert.equal(refreshCursor([c("b1", "05")], unlisted), null);
  // Con alguno del servidor, desde el más antiguo de ellos.
  assert.deepEqual(refreshCursor([c("x", "01"), c("b1", "05")], unlisted), { createdAt: "2026-11-12T10:00:01.000Z", id: "x" });
  assert.deepEqual(refreshCursor([c("b1", "05"), c("x", "07")], new Set()), { createdAt: "2026-11-12T10:00:05.000Z", id: "b1" });
});

test("applyFirstPage: la primera página manda desde su comentario más antiguo; lo anterior se conserva", () => {
  const ids = (l: { comments: CommentInfo[] }) => l.comments.map((x) => x.id);
  const all = (_id: string) => true;
  // Se ven 10..30 (lo de antes de 15, con «Ver anteriores»); otra persona borra 22, edita 20 y comenta 31.
  const cur = { comments: ["10", "12", "15", "20", "22", "25", "30"].map((at) => c(`k${at}`, at)), olderComments: 4 };
  const page = { comments: [c("k15", "15"), c("k20", "20", "editado"), c("k25", "25"), c("k30", "30"), c("k31", "31")], olderComments: 6 };
  const next = applyFirstPage(cur, page, all);
  assert.deepEqual(ids(next), ["k10", "k12", "k15", "k20", "k25", "k30", "k31"]);
  assert.equal(next.comments.find((x) => x.id === "k20")!.body, "editado");
  assert.equal(next.olderComments, 4, "lo de antes de la página sigue contando lo mismo");
  // Nada cargado antes de la página: los anteriores, los del servidor.
  assert.deepEqual(applyFirstPage({ comments: page.comments.slice(0, 2), olderComments: 6 }, page, all).olderComments, 6);
  // Sin anteriores en el servidor: la página es la lista entera (lo que ya no está, fuera).
  assert.deepEqual(ids(applyFirstPage(cur, { comments: [c("k30", "30")], olderComments: 0 }, all)), ["k30"]);
  // Más de una página de golpe (no enlaza con nada de lo que se veía): solo la página, con sus anteriores.
  const jump = { comments: [c("n40", "40"), c("n41", "41")], olderComments: 9 };
  assert.deepEqual(applyFirstPage(cur, jump, all), jump);
  // Un propio aún sin listar no sirve para enlazar: otra persona pudo comentar antes.
  const mine = { comments: [...cur.comments, c("m50", "50")], olderComments: 4 };
  assert.deepEqual(ids(applyFirstPage(mine, { comments: [c("n45", "45"), c("m50", "50")], olderComments: 30 }, (id) => id !== "m50")), ["n45", "m50"]);
});
