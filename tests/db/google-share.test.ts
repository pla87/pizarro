// Modo de compartir los documentos de Google por proyecto, contra PostgreSQL real y con fetch simulado.
import assert from "node:assert/strict";
import { afterEach, describe, test } from "node:test";
import { db, expectFail, expectOk, FORBIDDEN, loginAs, makeProject, makeTask, makeUser } from "./helpers";
import { setGoogleShareMode } from "../../src/actions/projects";
import { createGoogleFile } from "../../src/actions/tasks";
import { encryptSecret } from "../../src/lib/crypto";

process.env.GOOGLE_WORKSPACE_DOMAIN = "empresa.test";
delete process.env.GOOGLE_SHARE_ROLE;

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

/** Simula la API de Drive: crea el archivo y registra los permisos; `fail` decide cuáles responden con error. */
function mockDrive(fail: (body: Record<string, string>) => boolean = () => false) {
  const permissions: Record<string, string>[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (url.includes("/permissions")) {
      const body = JSON.parse(String(init?.body));
      if (fail(body)) return new Response("{}", { status: 403 });
      permissions.push(body);
      return new Response("{}", { status: 200 });
    }
    if (url.startsWith("https://www.googleapis.com/drive/v3/files")) {
      return Response.json({ id: "file1", name: "Doc de prueba", webViewLink: "https://docs.google.com/document/d/file1/edit" });
    }
    throw new Error(`fetch inesperado: ${url}`);
  }) as typeof fetch;
  return permissions;
}

async function connectGoogle(userId: string) {
  await db.googleAccount.create({
    data: { userId, email: "creador@example.test", refreshTokenEnc: encryptSecret("r"), accessTokenEnc: encryptSecret("a"), accessTokenExpiry: new Date(Date.now() + 3600_000), scope: "drive.file" },
  });
}

describe("setGoogleShareMode", () => {
  test("un administrador lo cambia en un proyecto de equipo, y los miembros no", async () => {
    const admin = await makeUser({ role: "ADMIN" });
    const member = await makeUser();
    const f = await makeProject({ members: [member] });
    await loginAs(member);
    expectFail(await setGoogleShareMode(f.project.id, "NONE"), FORBIDDEN);
    await loginAs(admin);
    expectOk(await setGoogleShareMode(f.project.id, "DOMAIN_READ"));
    assert.equal((await db.project.findUniqueOrThrow({ where: { id: f.project.id } })).googleShareMode, "DOMAIN_READ");
    expectFail(await setGoogleShareMode(f.project.id, "TODOS"));
  });

  test("un proyecto privado no admite los modos de dominio (solo sus miembros lo gestionan)", async () => {
    const owner = await makeUser();
    const outsider = await makeUser();
    const f = await makeProject({ visibility: "PRIVATE", owner });
    await loginAs(owner);
    expectFail(await setGoogleShareMode(f.project.id, "DOMAIN_WRITE"), /privado/);
    expectFail(await setGoogleShareMode(f.project.id, "DOMAIN_READ"), /privado/);
    expectOk(await setGoogleShareMode(f.project.id, "NONE"));
    expectOk(await setGoogleShareMode(f.project.id, "MEMBERS"));
    assert.equal((await db.project.findUniqueOrThrow({ where: { id: f.project.id } })).googleShareMode, "MEMBERS");
    await loginAs(outsider);
    expectFail(await setGoogleShareMode(f.project.id, "NONE"));
  });

  test("sin dominio configurado no se pueden elegir los modos de dominio", async () => {
    const admin = await makeUser({ role: "ADMIN" });
    const f = await makeProject({ members: [] });
    await loginAs(admin);
    const prev = process.env.GOOGLE_WORKSPACE_DOMAIN;
    delete process.env.GOOGLE_WORKSPACE_DOMAIN;
    try {
      expectFail(await setGoogleShareMode(f.project.id, "DOMAIN_WRITE"), /GOOGLE_WORKSPACE_DOMAIN/);
      expectOk(await setGoogleShareMode(f.project.id, "MEMBERS"));
    } finally {
      process.env.GOOGLE_WORKSPACE_DOMAIN = prev;
    }
  });
});

describe("createGoogleFile según el modo del proyecto", () => {
  test("sin modo guardado, un proyecto de equipo se comparte con el dominio como hasta ahora", async () => {
    const creator = await makeUser();
    await connectGoogle(creator.id);
    const f = await makeProject({ members: [creator] });
    const task = await makeTask(f);
    const permissions = mockDrive();
    await loginAs(creator);
    const link = expectOk(await createGoogleFile(task.id, "GOOGLE_DOC", "Doc"));
    assert.deepEqual(permissions, [{ type: "domain", domain: "empresa.test", role: "writer" }]);
    assert.equal(link.shareStatus, "SHARED");
  });

  test("modo MEMBERS: comparte con los demás miembros activos y un fallo parcial queda registrado", async () => {
    const creator = await makeUser();
    const a = await makeUser();
    const b = await makeUser();
    await connectGoogle(creator.id);
    const f = await makeProject({ members: [creator, a, b] });
    await db.project.update({ where: { id: f.project.id }, data: { googleShareMode: "MEMBERS" } });
    const task = await makeTask(f);
    const permissions = mockDrive((body) => body.emailAddress === b.email.toLowerCase());
    await loginAs(creator);
    const link = expectOk(await createGoogleFile(task.id, "GOOGLE_DOC", "Doc"));
    assert.deepEqual(permissions.map((p) => p.emailAddress), [a.email.toLowerCase()]);
    assert.equal(link.shareStatus, "PARTIAL");
    assert.equal(link.shareFailed, 1);
    const stored = await db.taskLink.findUniqueOrThrow({ where: { id: link.id } });
    assert.equal(stored.shareStatus, "PARTIAL");
  });

  test("modo NONE, o un fallo de la API de permisos: el documento se crea pero consta como no compartido", async () => {
    const creator = await makeUser();
    await connectGoogle(creator.id);
    const f = await makeProject({ members: [creator] });
    const task = await makeTask(f);
    await db.project.update({ where: { id: f.project.id }, data: { googleShareMode: "NONE" } });
    const none = mockDrive();
    await loginAs(creator);
    const a = expectOk(await createGoogleFile(task.id, "GOOGLE_SHEET", "Hoja"));
    assert.deepEqual(none, []);
    assert.equal(a.shareStatus, "NOT_SHARED");

    await db.project.update({ where: { id: f.project.id }, data: { googleShareMode: "DOMAIN_READ" } });
    const ok = mockDrive();
    const b = expectOk(await createGoogleFile(task.id, "GOOGLE_DOC", "Doc"));
    assert.deepEqual(ok, [{ type: "domain", domain: "empresa.test", role: "reader" }]);
    assert.equal(b.shareStatus, "SHARED");

    mockDrive(() => true);
    const c = expectOk(await createGoogleFile(task.id, "GOOGLE_DOC", "Doc"));
    assert.equal(c.shareStatus, "NOT_SHARED");
    assert.equal(await db.taskLink.count({ where: { taskId: task.id } }), 3);
  });

  test("un proyecto privado con un modo de dominio guardado comparte solo con sus miembros", async () => {
    const owner = await makeUser();
    const other = await makeUser();
    await connectGoogle(owner.id);
    const f = await makeProject({ visibility: "PRIVATE", owner, members: [other] });
    await db.project.update({ where: { id: f.project.id }, data: { googleShareMode: "DOMAIN_WRITE" } });
    const task = await makeTask(f);
    const permissions = mockDrive();
    await loginAs(owner);
    expectOk(await createGoogleFile(task.id, "GOOGLE_DOC", "Doc"));
    assert.deepEqual(permissions.map((p) => p.type), ["user"]);
  });
});
