// Avisos en el navegador: contador de sin leer de la cabecera al leerlos sin volver a pedir la página. La cabecera pone
// tal cual el recuento que devuelve el servidor (no lo baja ella): con otra pestaña o con más de 100 no se desincroniza.
import assert from "node:assert/strict";
import { test } from "node:test";
import { announceUnreadCount, latestOnly, onUnreadCount, restoreUnread, UNREAD_COUNT_CAP } from "../src/lib/unread-core";
import { readFileSync } from "node:fs";
import { isProjectNotice, notificationBody, notificationHeadline, projectNoticePath } from "../src/lib/notification-text";
import { channelWants, DEFAULT_CHANNEL_PREFS, noticeLinkLabel } from "../src/lib/messaging-core";
import { makeT } from "../src/i18n/core";

/** `window` de mentira (EventTarget) durante `fn`: las pruebas corren en Node. */
function withWindow(fn: () => void): void {
  const g = globalThis as { window?: unknown };
  const prev = g.window;
  g.window = new EventTarget();
  try {
    fn();
  } finally {
    if (prev === undefined) delete g.window;
    else g.window = prev;
  }
}

test("la cabecera recibe el número del servidor tal cual (también 0 y el tope), no un decremento", () => {
  withWindow(() => {
    const got: number[] = [];
    const stop = onUnreadCount((n) => got.push(n));
    announceUnreadCount(7);
    announceUnreadCount(0);
    announceUnreadCount(UNREAD_COUNT_CAP);
    // Lo que no es un recuento válido se ignora; por encima del tope se queda en el tope.
    window.dispatchEvent(new CustomEvent("pz:unread", { detail: { read: 1 } }));
    window.dispatchEvent(new CustomEvent("pz:unread", { detail: -3 }));
    announceUnreadCount(250);
    stop();
    announceUnreadCount(3);
    assert.deepEqual(got, [7, 0, UNREAD_COUNT_CAP, UNREAD_COUNT_CAP]);
  });
});

test("solo vale la respuesta de la última petición (dos avisos leídos seguidos)", () => {
  const gate = latestOnly();
  const first = gate.next();
  const second = gate.next();
  // La del primero llega tarde, con un número ya viejo: se descarta.
  assert.equal(gate.isLatest(second), true);
  assert.equal(gate.isLatest(first), false);
  // Cada lista tiene su propio contador.
  const other = latestOnly();
  assert.equal(other.isLatest(other.next()), true);
  assert.equal(gate.isLatest(second), true);
});

test("aviso de baja del informe semanal: de proyecto, lleva a Ajustes → Informes y sale con las menciones", () => {
  assert.equal(isProjectNotice("REPORT_UNSUBSCRIBED"), true);
  assert.equal(projectNoticePath("REPORT_UNSUBSCRIBED", "p1"), "/p/p1/settings?tab=informes");
  assert.equal(projectNoticePath("PROJECT_TO_TEAM", "p1"), "/p/p1");
  const es = makeT("es");
  const en = makeT("en");
  assert.equal(notificationHeadline("REPORT_UNSUBSCRIBED", es, { actor: "Rita", task: "«Huerto»" }), "Rita se ha dado de baja del informe semanal de «Huerto»");
  assert.equal(notificationHeadline("REPORT_UNSUBSCRIBED", en, { actor: "Rita", task: "“Huerto”" }), "Rita unsubscribed from the weekly report of “Huerto”");
  assert.match(notificationBody("REPORT_UNSUBSCRIBED", "Rita", es, "es-ES"), /Solo esa persona puede volver a activarlo/);
  assert.equal(noticeLinkLabel({ type: "REPORT_UNSUBSCRIBED" }, es), "Abrir los informes del proyecto");
  assert.equal(channelWants("REPORT_UNSUBSCRIBED", DEFAULT_CHANNEL_PREFS), true);
  assert.equal(channelWants("REPORT_UNSUBSCRIBED", { ...DEFAULT_CHANNEL_PREFS, notifyMention: false }), false);
});

test("deshacer «Marcar todo como leído»: sobre la lista de ahora (tras un refresco) y sin tocar los leídos uno a uno", () => {
  const was = new Set(["a", "b", "c"]);
  // Tras un refresco la lista es otra: «d» es nuevo y ya leído, «c» ya no está; «b» se ha leído aparte mientras tanto.
  const now = [{ id: "a", read: true }, { id: "b", read: true }, { id: "d", read: true }];
  assert.deepEqual(restoreUnread(now, was, new Set(["b"])), [{ id: "a", read: false }, { id: "b", read: true }, { id: "d", read: true }]);
  // Los que siguen sin leer no se copian.
  const same = { id: "a", read: false };
  assert.equal(restoreUnread([same], was, new Set())[0], same);
});

test("Avisos: la raya de la cita va al inicio del texto (también en RTL) y el foco de «Cargar más» se olvida con la lista nueva", () => {
  const src = readFileSync("src/app/(app)/notifications/NotificationList.tsx", "utf8");
  assert.match(src, /quotesWriting\(n\.type\) && "border-s-2 [^"]*ps-2/);
  assert.doesNotMatch(src, /border-l-2|\bpl-2\b/);
  assert.match(src, /focusFrom\.current = null;\n\s*listRef\.current\?\.querySelectorAll[^\n]*\n\s*\}, \[initial\]\)/);
});
