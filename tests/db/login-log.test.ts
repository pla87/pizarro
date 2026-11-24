// Inicio de sesión fallido en Administración → Logs: el email tecleado solo queda entero si es el de una cuenta; si no
// lo es (o no se ha mirado, como en el bloqueo por intentos), enmascarado («d***@example.com»): es un dato personal de
// alguien que quizá no es usuario. La búsqueda de Logs sigue encontrándolo por el dominio.
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { db, makeUser } from "./helpers";
import { login } from "../../src/actions/auth";
import { closeBcryptWorkers } from "../../src/lib/bcrypt-pool";
import { flushLogs } from "../../src/lib/log";
import { logWhere, parseLogFilters } from "../../src/lib/log-query";
import { hashPassword } from "../../src/lib/password";

after(() => closeBcryptWorkers());

async function attempt(email: string, password: string) {
  const form = new FormData();
  form.set("email", email);
  form.set("password", password);
  return login({}, form);
}

test("email desconocido: en el registro, enmascarado (inicial y dominio); el de una cuenta, entero", async () => {
  const tag = Date.now().toString(36);
  const unknown = `desconocida-${tag}@nadie-${tag}.example.com`;
  assert.ok((await attempt(unknown, "lo-que-sea-1234")).error);
  await flushLogs();
  const row = await db.appLog.findFirst({ where: { action: "auth.loginFailed", message: { contains: `nadie-${tag}` } } });
  assert.ok(row, "falta el registro del intento");
  const masked = `d***@nadie-${tag}.example.com`;
  const details = row!.details as { email: string; reason: string };
  assert.deepEqual([details.email, details.reason], [masked, "unknown_email"]);
  assert.ok(row!.message.includes(masked) && !row!.message.includes(unknown), row!.message);
  assert.ok(!JSON.stringify(row).includes(`desconocida-${tag}`));
  // La búsqueda por el dominio lo sigue encontrando.
  const found = await db.appLog.findMany({ where: logWhere(parseLogFilters({ q: `nadie-${tag}`, category: "auth" }), []) });
  assert.ok(found.some((r) => r.id === row!.id));

  // Contraseña incorrecta de una cuenta que existe: el email entero (con su usuario, que ya lo identifica).
  const user = await makeUser();
  await db.user.update({ where: { id: user.id }, data: { passwordHash: await hashPassword("clave-correcta-1234") } });
  assert.ok((await attempt(user.email, "otra-clave-1234")).error);
  await flushLogs();
  const wrong = await db.appLog.findFirst({ where: { action: "auth.loginFailed", userId: user.id } });
  assert.equal((wrong!.details as { email: string; reason: string }).email, user.email);
  assert.equal((wrong!.details as { reason: string }).reason, "wrong_password");
});
