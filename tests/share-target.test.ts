// «Compartir → Pizarro»: el share_target del manifiesto, la comprobación de origen de lo que llega y cómo se convierte
// en título y descripción de la nueva tarea.
import assert from "node:assert/strict";
import { test } from "node:test";
import { shareRequestAllowed, sharedText, shareTaskDescription, shareTaskTitle, shareTextQuery, SHARE_TEXT_MAX } from "../src/lib/share-core";
import { webManifest } from "../src/lib/web-manifest";

test("el manifiesto declara el destino de compartir: POST multipart con título, texto, enlace y archivos", () => {
  const st = webManifest("es").share_target!;
  assert.equal(st.action, "/api/share");
  assert.equal(st.method, "POST");
  assert.equal(st.enctype, "multipart/form-data");
  assert.deepEqual([st.params.title, st.params.text, st.params.url], ["title", "text", "url"]);
  const files = st.params.files as { name: string; accept: string[] }[];
  assert.equal(files[0]!.name, "files");
  assert.ok(files[0]!.accept.includes("image/*") && files[0]!.accept.includes("*/*"), "imágenes y cualquier otro archivo");
});

test("origen: la navegación del propio navegador sí; otra web, no", () => {
  const host = "pizarro.example.com";
  const ok = (h: { origin?: string; site?: string }, app?: string) => shareRequestAllowed({ origin: h.origin ?? null, secFetchSite: h.site ?? null, host }, app);
  assert.equal(ok({ site: "none" }), true, "compartir desde el sistema");
  assert.equal(ok({ site: "none", origin: "null" }), true);
  assert.equal(ok({ site: "same-origin", origin: `https://${host}` }), true);
  assert.equal(ok({ origin: "https://app.example.com" }, "https://app.example.com"), true, "Origin de APP_URL detrás de un proxy");
  assert.equal(ok({ site: "cross-site" }), false);
  assert.equal(ok({ site: "same-site", origin: "https://other.example.com" }), false);
  assert.equal(ok({ site: "none", origin: "https://evil.example.com" }), false, "un Origin ajeno manda aunque diga none");
  assert.equal(ok({ origin: "https://evil.example.com" }), false);
  assert.equal(ok({ origin: "no es una url" }), false);
  assert.equal(ok({}), false, "sin ninguna de las dos cabeceras no se admite");
});

test("título y descripción de la tarea a partir de lo compartido", () => {
  const s = (title = "", text = "", url = "") => sharedText({ title, text, url });
  assert.equal(shareTaskTitle(s("Artículo", "Léelo", "https://example.com/a")), "Artículo");
  assert.equal(shareTaskTitle(s("", "  \nPrimera línea\nsegunda")), "Primera línea");
  assert.equal(shareTaskTitle(s("", "https://www.example.com/x", "https://www.example.com/x")), "example.com", "un texto que solo es el enlace no sirve de título");
  assert.equal(shareTaskTitle(s("", "", "no es url")), "");
  assert.equal(Array.from(shareTaskTitle(s("😀".repeat(300)))).length, 210, "recortado al máximo de un título, sin partir emojis");
  assert.equal(shareTaskDescription(s("", "Mira esto", "https://example.com/a")), "Mira esto\n\nhttps://example.com/a");
  assert.equal(shareTaskDescription(s("", "Mira https://example.com/a", "https://example.com/a")), "Mira https://example.com/a", "el enlace no se repite");
  assert.equal(shareTaskDescription(s()), "");
});

test("los textos se recortan y sin sesión vuelven en la dirección del acceso", () => {
  const big = sharedText({ title: 5, text: "x".repeat(SHARE_TEXT_MAX + 50) + "\u0000", url: null });
  assert.deepEqual([big.title, big.text.length, big.url], ["", SHARE_TEXT_MAX, ""]);
  assert.equal(shareTextQuery(sharedText({}), 0), "/share");
  const q = new URL(shareTextQuery(sharedText({ title: "Hola", text: "y".repeat(5000), url: "https://example.com" }), 3), "http://x");
  assert.equal(q.pathname, "/share");
  assert.equal(q.searchParams.get("title"), "Hola");
  assert.equal(q.searchParams.get("text")!.length, 1500);
  assert.equal(q.searchParams.get("lost"), "3");
});
