// Mi perfil → Conectar Telegram: la espera de «Iniciar» se corta en cuanto el enlace deja de valer (antes seguía 10 min).
import assert from "node:assert/strict";
import { test } from "node:test";
import { telegramWaitState } from "../src/lib/telegram-wait";

const link = { bot: "pizarro_bot", expiresAt: "2026-11-11T10:10:00.000Z" };
const view = (over: Partial<{ available: boolean; botUsername: string; connected: boolean; linkExpiresAt: string | null }> = {}) => ({
  available: true, botUsername: "pizarro_bot", connected: false, linkExpiresAt: link.expiresAt, ...over,
});

test("con su código aún pendiente se sigue esperando; conectado, se termina", () => {
  assert.equal(telegramWaitState(link, view()), "waiting");
  assert.equal(telegramWaitState(link, view({ connected: true, linkExpiresAt: null })), "connected");
});

test("otro bot, Telegram desactivado o sin la sección: se deja de esperar ya", () => {
  assert.equal(telegramWaitState(link, view({ botUsername: "otro_bot", linkExpiresAt: null })), "botChanged");
  assert.equal(telegramWaitState(link, view({ available: false })), "botChanged");
  assert.equal(telegramWaitState(link, null), "botChanged");
});

test("sin código pendiente o con otro (se pidió otro enlace): el enlace ya no vale", () => {
  assert.equal(telegramWaitState(link, view({ linkExpiresAt: null })), "stale");
  assert.equal(telegramWaitState(link, view({ linkExpiresAt: "2026-11-11T10:12:00.000Z" })), "stale");
});
