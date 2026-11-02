// Acceso con contraseña cuando el servidor admite «solo Google» (AUTH_GOOGLE_ONLY): la respuesta no puede delatar si
// la contraseña era correcta (ni, con el acceso de emergencia de los administradores, si el email es de un miembro), y
// cada intento gasta el cupo por cuenta igual que un fallo.
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, test } from "node:test";
import { db, logout, makeUser } from "./helpers";
import { login } from "../../src/actions/auth";
import { hashPassword } from "../../src/lib/password";
import { LOGIN_ACCOUNT_LIMIT } from "../../src/lib/rate-limit";

const PASSWORD = "clave-correcta-1234";
const DISABLED = "El acceso con contraseña está desactivado en este servidor. Entra con Google.";
const EMERGENCY_FAIL = "Credenciales incorrectas. En este servidor solo los administradores entran con contraseña (acceso de emergencia); los demás, con Google.";
const TOO_MANY = "Demasiados intentos. Espera unos minutos.";

const hash = await hashPassword(PASSWORD);

async function account(role: "ADMIN" | "MEMBER") {
  const u = await makeUser({ role });
  await db.user.update({ where: { id: u.id }, data: { passwordHash: hash } });
  return u;
}

/** Resultado del formulario de acceso: el error que ve la persona, o adónde redirige si entra. */
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

const saved = { ...process.env };
function googleOnly(emergency: boolean) {
  process.env.GOOGLE_CLIENT_ID = "pizarro-tests.apps.example.com";
  process.env.GOOGLE_CLIENT_SECRET = "secreto-de-pruebas";
  process.env.APP_URL = "http://localhost:3000";
  process.env.AUTH_GOOGLE_ONLY = "true";
  if (emergency) process.env.AUTH_ALLOW_ADMIN_PASSWORD = "true";
  else delete process.env.AUTH_ALLOW_ADMIN_PASSWORD;
}

describe("acceso con contraseña con «solo Google»", () => {
  beforeEach(() => logout());
  afterEach(() => {
    for (const k of ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "APP_URL", "AUTH_GOOGLE_ONLY", "AUTH_ALLOW_ADMIN_PASSWORD"]) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  test("sin acceso de emergencia: la misma respuesta acierte o no, exista o no la cuenta, sea cual sea el rol", async () => {
    googleOnly(false);
    const member = await account("MEMBER");
    const admin = await account("ADMIN");
    for (const [email, password] of [[member.email, PASSWORD], [member.email, "otra-clave-9999"], [admin.email, PASSWORD], ["nadie@example.test", PASSWORD]] as const) {
      assert.deepEqual(await attempt(email, password), { error: DISABLED }, `${email} / ${password === PASSWORD ? "correcta" : "incorrecta"}`);
    }
    assert.equal(await db.session.count({ where: { userId: { in: [member.id, admin.id] } } }), 0);
  });

  test("con acceso de emergencia: miembro (con cualquier contraseña), email desconocido y admin equivocado ven lo mismo; el admin entra", async () => {
    googleOnly(true);
    const member = await account("MEMBER");
    const admin = await account("ADMIN");
    for (const [email, password] of [[member.email, PASSWORD], [member.email, "otra-clave-9999"], ["nadie@example.test", PASSWORD], [admin.email, "otra-clave-9999"]] as const) {
      assert.deepEqual(await attempt(email, password), { error: EMERGENCY_FAIL }, `${email} / ${password === PASSWORD ? "correcta" : "incorrecta"}`);
    }
    // El admin con su contraseña pasa al segundo paso (obligatorio para administradores).
    assert.deepEqual(await attempt(admin.email, PASSWORD), { redirect: "/login/verify" });
    assert.equal(await db.session.count({ where: { userId: member.id } }), 0);
  });

  test("cada intento de un rol sin contraseña gasta el cupo de la cuenta, aunque la contraseña sea correcta", async () => {
    for (const emergency of [false, true]) {
      googleOnly(emergency);
      const member = await account("MEMBER");
      for (let i = 0; i < LOGIN_ACCOUNT_LIMIT; i++) assert.notEqual((await attempt(member.email, PASSWORD)).error, TOO_MANY, `intento ${i + 1}`);
      assert.deepEqual(await attempt(member.email, PASSWORD), { error: TOO_MANY }, emergency ? "con acceso de emergencia" : "sin acceso de emergencia");
    }
  });

  test("sin «solo Google» todo sigue igual: la contraseña correcta entra y la incorrecta no", async () => {
    const member = await account("MEMBER");
    assert.deepEqual(await attempt(member.email, "otra-clave-9999"), { error: "Credenciales incorrectas." });
    assert.deepEqual(await attempt(member.email, PASSWORD), { redirect: "/" });
    assert.equal(await db.session.count({ where: { userId: member.id } }), 1);
  });
});
