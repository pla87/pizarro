import assert from "node:assert/strict";
import { test } from "node:test";

const { cacheEpoch, cachedMeta, forgetTaskAttachments, storeMeta } = await import("../src/lib/attachment-cache");

const meta = { id: "att1", taskId: "task1", projectId: "p1", isImage: true, originalName: "a.png", mimeType: "image/png" };

test("caché de adjuntos: lo leído antes de un borrado no se guarda después", () => {
  const readAt = cacheEpoch();
  forgetTaskAttachments(["task1"]); // la tarea se borra mientras la petición leía la BD
  storeMeta(meta, readAt);
  assert.equal(cachedMeta("att1"), undefined);
  storeMeta(meta, cacheEpoch());
  assert.deepEqual(cachedMeta("att1"), meta);
  forgetTaskAttachments(["task1"]);
  assert.equal(cachedMeta("att1"), undefined);
});
