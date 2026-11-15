import assert from "node:assert/strict";
import { test } from "node:test";
import { isCopyKey } from "../src/components/board/taskClipboard";

const ev = (o: Partial<KeyboardEvent>) => ({ ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, repeat: false, key: "", code: "", ...o }) as KeyboardEvent;

test("Ctrl+C copia la tarea también con teclados no latinos (por la tecla física)", () => {
  assert.equal(isCopyKey(ev({ ctrlKey: true, key: "c", code: "KeyC" })), true);
  assert.equal(isCopyKey(ev({ ctrlKey: true, key: "с", code: "KeyC" })), true); // cirílico
  assert.equal(isCopyKey(ev({ metaKey: true, key: "c", code: "KeyC" })), true);
  assert.equal(isCopyKey(ev({ ctrlKey: true, shiftKey: true, key: "C", code: "KeyC" })), false);
  assert.equal(isCopyKey(ev({ ctrlKey: true, key: "v", code: "KeyV" })), false);
});
