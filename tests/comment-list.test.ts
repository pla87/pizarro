// Lista de comentarios del detalle abierto: fusión por fecha e id sin repetidos y cursor del refresco en vivo.
import assert from "node:assert/strict";
import { test } from "node:test";
import { mergeComments, refreshCursor } from "../src/components/board/comment-list";
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
