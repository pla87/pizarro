// Cambio de email desde «Mi perfil»: la respuesta es la misma exista o no una cuenta con la dirección nueva. Si ya es de
// otra persona no se le envía nada ni se crea enlace; a la dirección actual le llega el aviso de siempre. Contra
// PostgreSQL real, con el buzón de pruebas (MAIL_OUTBOX_DIR).
import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { requestEmailChange } from "../../src/actions/profile";
import { closeBcryptWorkers } from "../../src/lib/bcrypt-pool";
import { hashPassword } from "../../src/lib/password";
import { afterDone, db, expectFail, expectOk, loginAs, makeUser } from "./helpers";

const PASSWORD = "clave-correcta-1234";
const hash = await hashPassword(PASSWORD);
let outbox = "";
const prevOutbox = process.env.MAIL_OUTBOX_DIR;
before(async () => {
  outbox = await mkdtemp(path.join(tmpdir(), "pz-email-change-"));
  process.env.MAIL_OUTBOX_DIR = outbox;
});
after(async () => {
  if (prevOutbox === undefined) delete process.env.MAIL_OUTBOX_DIR;
  else process.env.MAIL_OUTBOX_DIR = prevOutbox;
  await rm(outbox, { recursive: true, force: true });
  closeBcryptWorkers();
});

async function mailsTo(to: string): Promise<{ subject: string; text: string }[]> {
  const files = (await readdir(outbox)).filter((f) => f.endsWith(".json")).sort();
  const all = await Promise.all(files.map(async (f) => JSON.parse(await readFile(path.join(outbox, f), "utf8")) as { to: string; subject: string; text: string }));
  return all.filter((m) => m.to.toLowerCase() === to.toLowerCase());
}
const tokens = (userId: string) => db.authToken.count({ where: { userId, purpose: "EMAIL_CHANGE" } });

async function requester() {
  const u = await makeUser();
  await db.user.update({ where: { id: u.id }, data: { passwordHash: hash } });
  await loginAs(u);
  return u;
}

describe("cambiar el email sin delatar las cuentas", () => {
  test("dirección libre: enlace a la nueva y aviso a la actual", async () => {
    const u = await requester();
    const to = `libre-${Date.now().toString(36)}@example.com`;
    expectOk(await requestEmailChange(to, PASSWORD));
    await afterDone();
    assert.equal((await mailsTo(to)).length, 1);
    assert.match((await mailsTo(to))[0]!.text, /\/confirm\//);
    assert.equal((await mailsTo(u.email)).length, 1);
    assert.equal(await tokens(u.id), 1);
  });

  test("dirección de otra cuenta (también con otras mayúsculas): la misma respuesta, sin nada para esa cuenta", async () => {
    const other = await makeUser();
    for (const to of [other.email, other.email.toUpperCase()]) {
      const u = await requester();
      expectOk(await requestEmailChange(to, PASSWORD));
      await afterDone();
      assert.equal((await mailsTo(other.email)).length, 0, "a la otra cuenta no le llega nada");
      assert.equal(await tokens(u.id), 0, "sin enlace que confirmar");
      assert.equal((await mailsTo(u.email)).length, 1, "el aviso a la dirección actual sale igual");
    }
  });

  test("la contraseña se sigue pidiendo antes de nada", async () => {
    const other = await makeUser();
    await requester();
    expectFail(await requestEmailChange(other.email, "mala-clave-123"), "La contraseña actual no es correcta.");
  });
});
