// Inicio de sesión con el servidor ya comprobando demasiadas contraseñas a la vez: se responde «demasiados intentos a la
// vez» sin mirar la contraseña, igual exista o no la cuenta, y ese intento no cuenta como fallo de la cuenta. Lo mismo en
// las demás pantallas que piden la contraseña con su propio límite de intentos (perfil, dos pasos, descarga de copias).
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, beforeEach, describe, test } from "node:test";
import { db, expectFail, loginAs, logout, makeUser } from "./helpers";
import { login } from "../../src/actions/auth";
import { requestBackupDownload } from "../../src/actions/backups";
import { changePassword, requestEmailChange } from "../../src/actions/profile";
import { beginEnrollment } from "../../src/actions/two-factor";
import { closeBcryptWorkers } from "../../src/lib/bcrypt-pool";
import { hashPassword, PASSWORD_CHECKS_AT_ONCE, PASSWORD_QUEUE, passwordCheckStats } from "../../src/lib/password";
import { LOGIN_ACCOUNT_LIMIT, loginRateKeys, rateLimitReached } from "../../src/lib/rate-limit";
import type { Semaphore } from "../../src/lib/semaphore";

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

/**
 * Ocupa todos los huecos y la cola de comprobaciones (el semáforo compartido de password.ts) con tareas que esperan;
 * devuelve la función que las suelta. Sin bcrypt de por medio: la prueba no depende de lo que tarde.
 */
function saturate(): () => Promise<unknown> {
  const sem = (globalThis as unknown as { __pzPasswordSem: Semaphore }).__pzPasswordSem;
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const all = Promise.allSettled(Array.from({ length: PASSWORD_CHECKS_AT_ONCE + PASSWORD_QUEUE }, () => sem.run(() => gate)));
  const s = passwordCheckStats();
  assert.equal(s.active + s.waiting, PASSWORD_CHECKS_AT_ONCE + PASSWORD_QUEUE);
  return () => {
    release();
    return all;
  };
}

describe("acceso con el servidor saturado de comprobaciones de contraseña", () => {
  beforeEach(() => logout());

  test("misma respuesta con cuenta o sin ella, y el intento no gasta el cupo de la cuenta", async () => {
    const user = await makeUser();
    await db.user.update({ where: { id: user.id }, data: { passwordHash: hash } });
    const key = loginRateKeys("unknown", user.email).account;
    // Más intentos que el cupo de la cuenta, todos con el servidor saturado: ninguno cuenta.
    for (let i = 0; i < LOGIN_ACCOUNT_LIMIT + 1; i++) {
      const done = saturate();
      assert.deepEqual(await attempt(user.email, "otra-clave-9999"), { error: BUSY });
      assert.deepEqual(await attempt("nadie@example.com", PASSWORD), { error: BUSY });
      await done();
    }
    assert.equal(rateLimitReached(key, 1), false, "los intentos sin comprobar no cuentan como fallos");
    // Ya sin saturar, la contraseña correcta entra.
    assert.deepEqual(await attempt(user.email, PASSWORD), { redirect: "/" });
  });
});

describe("otras pantallas que piden la contraseña, con el servidor saturado", () => {
  beforeEach(() => logout());

  // Cada acción, su clave del límite y su cupo: con el servidor ocupado no se gasta ni un intento.
  const cases: { name: string; key: (id: string) => string; limit: number; admin?: boolean; run: () => Promise<{ ok: true; data: unknown } | { ok: false; error: string }> }[] = [
    { name: "cambiar la contraseña (Mi perfil)", key: (id) => `password:${id}`, limit: 5, run: () => changePassword(PASSWORD, "clave-nueva-larga-1234") },
    { name: "activar la verificación en dos pasos", key: (id) => `2fa:pw:${id}`, limit: 10, run: () => beginEnrollment("TOTP", PASSWORD) },
    { name: "descargar una copia de seguridad", key: (id) => `backup-dl:${id}`, limit: 5, admin: true, run: () => requestBackupDownload({ password: PASSWORD }) },
  ];
  for (const c of cases) {
    test(`${c.name}: «demasiados a la vez» sin gastar intentos; después, la contraseña correcta funciona`, async () => {
      const user = await makeUser({ role: c.admin ? "ADMIN" : "MEMBER" });
      await db.user.update({ where: { id: user.id }, data: { passwordHash: hash } });
      await loginAs(user);
      for (let i = 0; i < c.limit + 1; i++) {
        const done = saturate();
        expectFail(await c.run(), BUSY);
        await done();
      }
      assert.equal(rateLimitReached(c.key(user.id), 1), false, "los intentos sin comprobar no cuentan");
      const res = await c.run();
      assert.ok(res.ok, res.ok ? "" : res.error);
    });
  }

  test("cambiar el email: tampoco gasta intentos con el servidor saturado", async () => {
    const user = await makeUser();
    await db.user.update({ where: { id: user.id }, data: { passwordHash: hash } });
    await loginAs(user);
    // Con email (aquí, la bandeja de salida en una carpeta): sin él, la acción se para antes de pedir la contraseña.
    const dir = await mkdtemp(path.join(tmpdir(), "pz-outbox-"));
    const prev = process.env.MAIL_OUTBOX_DIR;
    process.env.MAIL_OUTBOX_DIR = dir;
    try {
      for (let i = 0; i < 6; i++) {
        const done = saturate();
        expectFail(await requestEmailChange("nuevo@example.com", PASSWORD), BUSY);
        await done();
      }
      assert.equal(rateLimitReached(`email-change:${user.id}`, 1), false, "los intentos sin comprobar no cuentan");
    } finally {
      if (prev === undefined) delete process.env.MAIL_OUTBOX_DIR;
      else process.env.MAIL_OUTBOX_DIR = prev;
      await rm(dir, { recursive: true, force: true });
    }
  });
});
