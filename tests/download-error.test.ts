// Aviso de una descarga de columna (PDF del plan, de la semana, de la lista, programa) que el servidor rechaza.
import assert from "node:assert/strict";
import { test } from "node:test";
import { downloadErrorText } from "../src/components/board/download-error";
import { isSessionExpiredMessage, SESSION_EXPIRED } from "../src/components/ui/session-expired";

const t = (s: string) => s;
const FAILED = "No se pudo generar el PDF.";

test("sin sesión (401) sale el aviso de sesión caducada, nunca el JSON del proxy", () => {
  const text = downloadErrorText(401, '{"error":"No autorizado"}', FAILED, t);
  assert.equal(text, SESSION_EXPIRED);
  // El aviso lo reconoce y lo convierte en el fijo con «Iniciar sesión» (Toast).
  assert.ok(isSessionExpiredMessage(text, t));
  assert.equal(downloadErrorText(401, "", FAILED, t), SESSION_EXPIRED);
});

test("el tope por minuto (429) dice qué hacer", () => {
  assert.equal(downloadErrorText(429, "Demasiadas peticiones", FAILED, t), "Has pedido muchos PDF seguidos: espera un minuto y vuelve a intentarlo.");
});

test("otro error: su texto si es corto (el de un JSON con «error»); si no, el texto de reserva", () => {
  assert.equal(downloadErrorText(404, "No encontrado", FAILED, t), "No encontrado");
  assert.equal(downloadErrorText(403, '{"error":"No tienes acceso"}', FAILED, t), "No tienes acceso");
  assert.equal(downloadErrorText(500, '{"detail":"x"}', FAILED, t), FAILED);
  assert.equal(downloadErrorText(500, "{roto", FAILED, t), FAILED);
  assert.equal(downloadErrorText(502, "<html><body>Bad gateway</body></html>", FAILED, t), FAILED);
  assert.equal(downloadErrorText(500, "x".repeat(300), FAILED, t), FAILED);
  assert.equal(downloadErrorText(500, "  ", FAILED, t), FAILED);
});
