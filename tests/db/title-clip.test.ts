// Un título más largo que el máximo (210) no tira el guardado: se guarda recortado y la respuesta lo indica
// (`titleClipped`) para que el cliente avise. Crear, editar y alta en bloque.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { db, expectOk, loginAs, makeProject, makeTask, makeUser } from "./helpers";
import { createTask, createTasks, updateTask } from "../../src/actions/tasks";
import { MAX_TITLE } from "../../src/lib/constants";
import { mentionToken } from "../../src/lib/mentions";
import { titleLength } from "../../src/lib/title-clamp";

async function setup() {
  const user = await makeUser();
  const f = await makeProject({ members: [user] });
  await loginAs(user);
  return { user, f };
}

describe("título demasiado largo: se recorta, no se rechaza", () => {
  test("crear: guarda el título cortado al máximo y avisa", async () => {
    const { f } = await setup();
    const task = expectOk(await createTask({ projectId: f.project.id, columnId: f.columns.todo, title: `  ${"ñ".repeat(400)}  `, kindId: f.kindId }));
    assert.equal(task.title.length, MAX_TITLE);
    assert.equal(task.titleClipped, MAX_TITLE);
    const row = await db.task.findUniqueOrThrow({ where: { id: task.id }, select: { title: true } });
    assert.equal(row.title, "ñ".repeat(MAX_TITLE));
  });

  test("crear: un título que cabe no trae aviso", async () => {
    const { f } = await setup();
    const task = expectOk(await createTask({ projectId: f.project.id, columnId: f.columns.todo, title: "a".repeat(MAX_TITLE), kindId: f.kindId }));
    assert.equal(task.title.length, MAX_TITLE);
    assert.equal(task.titleClipped, undefined);
  });

  test("crear: no parte un emoji ni una mención", async () => {
    const { user, f } = await setup();
    const head = "a".repeat(MAX_TITLE - 1);
    const emoji = expectOk(await createTask({ projectId: f.project.id, columnId: f.columns.todo, title: `${head}😀 fin`, kindId: f.kindId }));
    assert.equal(emoji.title, head);
    const mention = mentionToken("Ana", user.id);
    const withMention = expectOk(await createTask({ projectId: f.project.id, columnId: f.columns.todo, title: `${"b".repeat(MAX_TITLE - 2)} ${mention}`, kindId: f.kindId }));
    assert.equal(withMention.title, "b".repeat(MAX_TITLE - 2));
    assert.equal(withMention.titleClipped, MAX_TITLE);
    // Con la mención dentro del máximo, se conserva entera (el límite cuenta el texto visible).
    const kept = expectOk(await createTask({ projectId: f.project.id, columnId: f.columns.todo, title: `${mention} ${"c".repeat(400)}`, kindId: f.kindId }));
    assert.ok(kept.title.startsWith(`${mention} c`));
    assert.equal(titleLength(kept.title), MAX_TITLE);
  });

  test("editar: recorta el título nuevo y avisa", async () => {
    const { f } = await setup();
    const t = await makeTask(f, { title: "Corto" });
    const res = expectOk(await updateTask(t.id, { title: "z".repeat(1000) }));
    assert.equal(res.title.length, MAX_TITLE);
    assert.equal(res.titleClipped, MAX_TITLE);
    const row = await db.task.findUniqueOrThrow({ where: { id: t.id }, select: { title: true } });
    assert.equal(row.title.length, MAX_TITLE);
    const ok = expectOk(await updateTask(t.id, { title: "Otro" }));
    assert.equal(ok.title, "Otro");
    assert.equal(ok.titleClipped, undefined);
  });

  test("alta en bloque: solo avisa en las líneas recortadas", async () => {
    const { f } = await setup();
    const rows = expectOk(
      await createTasks({
        projectId: f.project.id,
        columnId: f.columns.todo,
        tasks: [{ title: "Normal", kindId: f.kindId }, { title: "L".repeat(300), kindId: f.kindId }],
      }),
    );
    const normal = rows.find((r) => r.title === "Normal");
    const long = rows.find((r) => r.title !== "Normal");
    assert.ok(normal && long);
    assert.equal(normal.titleClipped, undefined);
    assert.equal(long.title.length, MAX_TITLE);
    assert.equal(long.titleClipped, MAX_TITLE);
  });
});
