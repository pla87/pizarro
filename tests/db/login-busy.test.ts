// Inicio de sesión con el servidor ya comprobando demasiadas contraseñas a la vez: se responde «demasiados intentos a la
// vez» sin mirar la contraseña, igual exista o no la cuenta, y ese intento no cuenta como fallo de la cuenta.
import assert from "node:assert/strict";
import { after, beforeEach, describe, test } from "node:test";
import { db, logout, makeUser } from "./helpers";
import { login } from "../../src/actions/auth";
import { closeBcryptWorkers } from "../../src/lib/bcrypt-pool";
import { hashPassword, PASSWORD_CHECKS_AT_ONCE, PASSWORD_QUEUE, passwordCheckStats, verifyPassword } from "../../src/lib/password";
import { LOGIN_ACCOUNT_LIMIT, loginRateKeys, rateLimitReached } from "../../src/lib/rate-limit";

const PASSWORD = "clave-correcta-1234";
const BUSY = "Demasiados intentos a la vez, prueba en unos segundos.";
const hash = await hashPassword(PASSWORD);

after(() => closeBcryptWorkers());

async function attempt(email: string, password: string): Promise<{ error?: string; redirect?: string }> {
  const form = new FormData();
  form.set("email", email);
  form.set("password", password);
  try {
    return await login({}, form);
  } catch (err) {
    const digest = (err as { digest?: string }).digest ?? "";
    if (digest.startsWith("NEXT_REDIRECT")) return { redirect: digest.split(";")[2] };
    throw err;
  }
}

/** Ocupa todos los huecos y la cola de comprobaciones; devuelve la promesa de que terminen. */
function saturate(): Promise<unknown> {
  const all = Promise.allSettled(Array.from({ length: PASSWORD_CHECKS_AT_ONCE + PASSWORD_QUEUE }, () => verifyPassword("x", hash)));
  const s = passwordCheckStats();
  assert.equal(s.active + s.waiting, PASSWORD_CHECKS_AT_ONCE + PASSWORD_QUEUE);
  return all;
}

describe("acceso con el servidor saturado de comprobaciones de contraseña", () => {
  beforeEach(() => logout());

  test("misma respuesta con cuenta o sin ella, y el intento no gasta el cupo de la cuenta", async () => {
    const user = await makeUser();
    await db.user.update({ where: { id: user.id }, data: { passwordHash: hash } });
    const key = loginRateKeys("unknown", user.email).account;
    // Más intentos que el cupo de la cuenta, todos con el servidor saturado: ninguno cuenta.
    for (let i = 0; i < LOGIN_ACCOUNT_LIMIT + 1; i++) {
      const busy = saturate();
      assert.deepEqual(await attempt(user.email, "otra-clave-9999"), { error: BUSY });
      assert.deepEqual(await attempt("nadie@example.com", PASSWORD), { error: BUSY });
      await busy;
    }
    assert.equal(rateLimitReached(key, 1), false, "los intentos sin comprobar no cuentan como fallos");
    // Ya sin saturar, la contraseña correcta entra.
    assert.deepEqual(await attempt(user.email, PASSWORD), { redirect: "/" });
  });
});
