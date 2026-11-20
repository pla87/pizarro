// Recuentos de comentarios, enlaces, subtareas y adjuntos de las tarjetas (tablero, creación múltiple y una sola tarea) y
// si tienen descripción, contados en una sola consulta filtrada por las tareas pedidas: deben coincidir con los de antes,
// no mezclar otros proyectos y no recorrer las filas de todo el servidor.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import pg from "pg";
import { db, expectOk, loginAs, makeProject, makeTask, makeUser } from "./helpers";
import { createTasks } from "../../src/actions/tasks";
import { loadBoardTask, loadBoardTasks, loadBoardTasksByIds } from "../../src/lib/board";

async function comments(taskId: string, n: number, deleted = 0) {
  await db.taskComment.createMany({ data: Array.from({ length: n + deleted }, (_, i) => ({ taskId, body: `c${i}`, deletedAt: i < deleted ? new Date() : null })) });
}
async function links(taskId: string, n: number) {
  await db.taskLink.createMany({ data: Array.from({ length: n }, (_, i) => ({ taskId, kind: "GOOGLE_DOC" as const, title: `Doc ${i}`, url: `https://example.com/d/${i}` })) });
}

describe("recuentos de las tarjetas", () => {
  test("tablero: comentarios sin los borrados y enlaces, solo de sus tareas; las de otros proyectos no cuentan", async () => {
    const user = await makeUser();
    const f = await makeProject({ members: [user] });
    const other = await makeProject({ members: [user] });
    const a = await makeTask(f);
    const b = await makeTask(f, { position: 2000 });
    const c = await makeTask(f, { position: 3000 });
    const archived = await makeTask(f, { position: 4000 });
    const foreign = await makeTask(other);
    await comments(a.id, 3, 2);
    await links(a.id, 2);
    await comments(b.id, 0, 1); // solo borrados → 0
    await links(c.id, 1);
    await comments(archived.id, 5);
    await db.task.update({ where: { id: archived.id }, data: { archivedAt: new Date() } });
    await comments(foreign.id, 7);
    await links(foreign.id, 4);

    const board = await loadBoardTasks(f.project.id);
    const counts = Object.fromEntries(board.map((t) => [t.id, [t.commentCount, t.linkCount]]));
    assert.deepEqual(counts, { [a.id]: [3, 2], [b.id]: [0, 0], [c.id]: [0, 1] });
    // Lo mismo que da una sola tarea (loadBoardTask, que sigue con `_count`) y la carga por ids.
    for (const t of [a, b, c]) {
      const one = await loadBoardTask(t.id);
      assert.deepEqual([one.commentCount, one.linkCount], counts[t.id]);
    }
    const byIds = await loadBoardTasksByIds([c.id, a.id, foreign.id]);
    assert.deepEqual(Object.fromEntries(byIds.map((t) => [t.id, [t.commentCount, t.linkCount]])), { [a.id]: [3, 2], [c.id]: [0, 1], [foreign.id]: [7, 4] });
    assert.deepEqual(await loadBoardTasksByIds([]), []);
  });

  test("creación múltiple: devuelve las tarjetas nuevas con sus recuentos a cero y en el orden del tablero", async () => {
    const user = await makeUser();
    const f = await makeProject({ members: [user] });
    await loginAs(user);
    const created = expectOk(await createTasks({ projectId: f.project.id, columnId: f.columns.todo, tasks: [{ title: "Uno", kindId: f.kindId }, { title: "Dos", kindId: f.kindId }] }));
    assert.deepEqual(created.map((t) => [t.title, t.commentCount, t.linkCount, t.hasDescription]), [["Uno", 0, 0, false], ["Dos", 0, 0, false]]);
  });

  // Antes el tablero traía una fila por subtarea y por adjunto solo para contarlas; ahora son groupBy por tarea.
  test("subtareas (hechas y total) y adjuntos (imágenes, ficheros y bytes): lo mismo en el tablero, por ids y en una sola", async () => {
    const user = await makeUser();
    const f = await makeProject({ members: [user] });
    const other = await makeProject({ members: [user] });
    const a = await makeTask(f, { subtasks: ["s1", "s2", "s3"] });
    const b = await makeTask(f, { position: 2000 });
    const c = await makeTask(f, { position: 3000, subtasks: ["x"] });
    const foreign = await makeTask(other, { subtasks: ["y", "z"] });
    await db.subtask.updateMany({ where: { taskId: a.id, title: { in: ["s1", "s3"] } }, data: { done: true } });
    const att = (taskId: string, isImage: boolean, size: number) => ({ taskId, originalName: `f${size}`, mimeType: isImage ? "image/webp" : "text/plain", isImage, size });
    await db.taskAttachment.createMany({ data: [att(a.id, true, 100), att(a.id, true, 250), att(a.id, false, 7), att(c.id, false, 40), att(foreign.id, true, 9)] });
    const pick = (t: Awaited<ReturnType<typeof loadBoardTask>>) => [t.subtaskTotal, t.subtaskDone, t.imageCount, t.fileCount, t.attachBytes];
    const want = { [a.id]: [3, 2, 2, 1, 357], [b.id]: [0, 0, 0, 0, 0], [c.id]: [1, 0, 0, 1, 40] };
    assert.deepEqual(Object.fromEntries((await loadBoardTasks(f.project.id)).map((t) => [t.id, pick(t)])), want);
    for (const t of [a, b, c]) assert.deepEqual(pick(await loadBoardTask(t.id)), want[t.id]);
    assert.deepEqual(Object.fromEntries((await loadBoardTasksByIds([c.id, foreign.id])).map((t) => [t.id, pick(t)])), { [c.id]: want[c.id], [foreign.id]: [2, 0, 1, 0, 9] });
  });

  // El mismo criterio que el navegador (`description.trim().length > 0`, TaskDialog) en el tablero, por ids y en una sola.
  test("«tiene descripción»: la que solo tiene espacios (también Unicode o saltos de línea) no cuenta, en las tres cargas", async () => {
    const user = await makeUser();
    const f = await makeProject({ members: [user] });
    const texts = ["", " ", "  \n\t ", "\u00a0\u3000\u2028\ufeff\v\f\r\u1680\u2000\u200a\u202f\u205f\u2029", "x", "   \n  hola", " ".repeat(500) + "fin", "\u200b", "\u0085", "**negrita**"];
    const tasks = [];
    for (const [i, description] of texts.entries()) {
      const t = await makeTask(f, { position: (i + 1) * 1000 });
      await db.task.update({ where: { id: t.id }, data: { description }, select: { id: true } });
      tasks.push({ id: t.id, want: description.trim().length > 0 });
    }
    const board = new Map((await loadBoardTasks(f.project.id)).map((t) => [t.id, t.hasDescription]));
    const byIds = new Map((await loadBoardTasksByIds(tasks.map((t) => t.id))).map((t) => [t.id, t.hasDescription]));
    for (const [i, t] of tasks.entries()) {
      assert.equal(board.get(t.id), t.want, `tablero, texto ${i}`);
      assert.equal(byIds.get(t.id), t.want, `por ids, texto ${i}`);
      assert.equal((await loadBoardTask(t.id)).hasDescription, t.want, `una sola, texto ${i}`);
    }
  });

  // Antes eran groupBy con `where: { task: { projectId } }`: Prisma los convertía en un JOIN con Task que se resolvía con
  // un Seq Scan de todos los comentarios (y subtareas) del servidor. Se comprueba el plan de cada consulta de la carga.
  test("guarda: cargar el tablero no recorre los comentarios, subtareas, adjuntos ni enlaces de otros proyectos", async () => {
    const user = await makeUser();
    const f = await makeProject({ members: [user] });
    const other = await makeProject({ members: [user] });
    const many = (fx: typeof f, n: number) => db.task.createManyAndReturn({
      data: Array.from({ length: n }, (_, i) => ({ projectId: fx.project.id, columnId: fx.columns.todo, kindId: fx.kindId, title: `T${i}`, position: (i + 1) * 1000, description: i % 2 ? "texto" : "" })),
      select: { id: true },
    });
    const mine = await many(f, 300);
    await many(other, 1200);
    // Filas de las cuatro tablas en las dos: el tablero es una parte grande del servidor (así el plan de antes, con el
    // JOIN, elegía recorrer la tabla entera) pero lo de otros proyectos es mucho más.
    for (const [project, n] of [[f.project.id, 2], [other.project.id, 20]] as const) {
      await db.$executeRaw`INSERT INTO "TaskComment" ("id", "taskId", "body") SELECT gen_random_uuid()::text, t."id", 'c' FROM "Task" t, generate_series(1, ${n}) WHERE t."projectId" = ${project}`;
      await db.$executeRaw`INSERT INTO "Subtask" ("id", "taskId", "title", "position", "done") SELECT gen_random_uuid()::text, t."id", 's', g, g = 1 FROM "Task" t, generate_series(1, ${n}) g WHERE t."projectId" = ${project}`;
      await db.$executeRaw`INSERT INTO "TaskAttachment" ("id", "taskId", "originalName", "size", "isImage") SELECT gen_random_uuid()::text, t."id", 'f', g, g % 2 = 0 FROM "Task" t, generate_series(1, ${n}) g WHERE t."projectId" = ${project}`;
      await db.$executeRaw`INSERT INTO "TaskLink" ("id", "taskId", "kind", "title", "url") SELECT gen_random_uuid()::text, t."id", 'GOOGLE_DOC', 'd', 'https://example.com/d' FROM "Task" t, generate_series(1, ${n}) WHERE t."projectId" = ${project}`;
    }
    await db.$executeRawUnsafe(`ANALYZE "Task", "TaskComment", "Subtask", "TaskAttachment", "TaskLink"`);

    // Las consultas SQL que hace cada carga (texto y parámetros), para pedir después su plan.
    const proto = pg.Client.prototype as unknown as { query: (...args: unknown[]) => unknown };
    const orig = proto.query;
    const seen: { text: string; values: unknown[] }[] = [];
    proto.query = function (this: unknown, ...args: unknown[]) {
      const q = args[0] as { text?: string; values?: unknown[] } | string;
      if (typeof q === "object" && q?.text) seen.push({ text: q.text, values: q.values ?? [] });
      return orig.apply(this, args);
    };
    let board, byIds;
    try {
      board = await loadBoardTasks(f.project.id);
      byIds = await loadBoardTasksByIds(mine.slice(0, 100).map((t) => t.id));
      await loadBoardTask(mine[0]!.id);
    } finally {
      proto.query = orig;
    }
    // Los recuentos son los de sus tareas (2 de cada) y no los de las del otro proyecto (20).
    assert.equal(board.length, 300);
    for (const t of [...board, ...byIds]) {
      assert.deepEqual([t.commentCount, t.linkCount, t.subtaskTotal, t.subtaskDone, t.imageCount, t.fileCount, t.attachBytes], [2, 2, 2, 1, 1, 1, 3]);
    }

    const children = new Set(["TaskComment", "Subtask", "TaskAttachment", "TaskLink"]);
    const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
    try {
      const scans: string[] = [];
      const walk = (node: { "Node Type": string; "Relation Name"?: string; Plans?: unknown[] }) => {
        if (node["Node Type"] === "Seq Scan" && node["Relation Name"] && children.has(node["Relation Name"])) scans.push(node["Relation Name"]);
        for (const child of node.Plans ?? []) walk(child as typeof node);
      };
      const selects = seen.filter((q) => /^\s*(SELECT|WITH)\b/i.test(q.text));
      assert.ok(selects.some((q) => q.text.includes('"TaskComment"')), "alguna consulta cuenta los comentarios");
      for (const q of selects) {
        const res = await client.query({ text: `EXPLAIN (FORMAT JSON) ${q.text}`, values: q.values });
        walk((res.rows[0]["QUERY PLAN"] as { Plan: Parameters<typeof walk>[0] }[])[0]!.Plan);
      }
      assert.deepEqual(scans, [], "ninguna carga recorre entera una tabla de comentarios, subtareas, adjuntos o enlaces");
    } finally {
      await client.end();
    }
  });
});
