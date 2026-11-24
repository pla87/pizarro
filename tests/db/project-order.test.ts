// Orden de los proyectos de cada usuario (Mi perfil → Preferencias): últimas aperturas (ProjectVisit), su escritura
// barata, el orden del selector (listVisibleProjects) y la preferencia guardada, contra PostgreSQL real.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { db, expectOk, loginAs, makeProject, makeTask, makeUser } from "./helpers";
import { updateProjectOrder } from "../../src/actions/profile";
import { listVisibleProjects } from "../../src/lib/access";
import { overdueMyTasksCount } from "../../src/lib/my-tasks-server";
import { noteProjectVisit, projectVisitDue } from "../../src/lib/project-visit";
import { getCurrentUser, type CurrentUser } from "../../src/lib/session";

const MIN = 60_000;

function asCurrent(u: { id: string; email: string; name: string; role: "ADMIN" | "MEMBER" }, projectOrder: CurrentUser["projectOrder"], locale: CurrentUser["locale"] = "ES"): CurrentUser {
  return { id: u.id, email: u.email, name: u.name, role: u.role, theme: "SYSTEM", accent: "BLUE", locale, clearDraftsOnLogout: false, projectOrder };
}

async function visitedAt(userId: string, projectId: string): Promise<number | null> {
  const row = await db.projectVisit.findUnique({ where: { userId_projectId: { userId, projectId } }, select: { visitedAt: true } });
  return row?.visitedAt.getTime() ?? null;
}

describe("aperturas de proyecto (ProjectVisit)", () => {
  test("en el mismo proyecto, como mucho una escritura cada 5 minutos; al cambiar de proyecto, siempre", async () => {
    const user = await makeUser();
    const a = await makeProject({ members: [user] });
    const b = await makeProject({ members: [user] });
    const t0 = new Date("2026-11-20T10:00:00.000Z");
    await noteProjectVisit(user.id, a.project.id, t0);
    assert.equal(await visitedAt(user.id, a.project.id), t0.getTime());
    // Refrescos y recargas del mismo tablero: no escriben.
    await noteProjectVisit(user.id, a.project.id, new Date(t0.getTime() + 2 * MIN));
    assert.equal(await visitedAt(user.id, a.project.id), t0.getTime());
    // Otro proyecto y vuelta al primero enseguida: los dos se anotan (el último abierto queda arriba).
    await noteProjectVisit(user.id, b.project.id, new Date(t0.getTime() + 3 * MIN));
    await noteProjectVisit(user.id, a.project.id, new Date(t0.getTime() + 4 * MIN));
    assert.equal(await visitedAt(user.id, b.project.id), t0.getTime() + 3 * MIN);
    assert.equal(await visitedAt(user.id, a.project.id), t0.getTime() + 4 * MIN);
    // Pasados 5 minutos en el mismo, se vuelve a anotar.
    await noteProjectVisit(user.id, a.project.id, new Date(t0.getTime() + 10 * MIN));
    assert.equal(await visitedAt(user.id, a.project.id), t0.getTime() + 10 * MIN);
  });

  test("projectVisitDue: memoria con tope y sin escribir dos veces seguidas lo mismo", () => {
    const memory = new Map<string, { projectId: string; at: number }>();
    assert.equal(projectVisitDue("u", "p", 0, memory), true);
    assert.equal(projectVisitDue("u", "p", MIN, memory), false);
    assert.equal(projectVisitDue("u", "q", 2 * MIN, memory), true);
    assert.equal(projectVisitDue("u", "q", 7 * MIN + 1, memory), true);
    // Reloj hacia atrás: se anota (no se queda callado para siempre).
    assert.equal(projectVisitDue("u", "q", 0, memory), true);
    for (let i = 0; i < 10_050; i++) projectVisitDue(`x${i}`, "p", 0, memory);
    assert.ok(memory.size <= 10_000);
  });

  test("se borran con el proyecto y con el usuario; un proyecto que ya no existe no falla", async () => {
    const user = await makeUser();
    const other = await makeUser();
    const a = await makeProject({ members: [user, other] });
    await noteProjectVisit(user.id, a.project.id);
    await noteProjectVisit(other.id, a.project.id);
    await db.user.delete({ where: { id: other.id } });
    assert.equal(await db.projectVisit.count({ where: { userId: other.id } }), 0);
    await db.project.delete({ where: { id: a.project.id } });
    assert.equal(await db.projectVisit.count({ where: { projectId: a.project.id } }), 0);
    await noteProjectVisit(user.id, "c000000000000000000000000");
    assert.equal(await db.projectVisit.count({ where: { userId: user.id } }), 0);
  });
});

describe("orden de los proyectos en el selector (listVisibleProjects)", () => {
  test("usados recientemente: el último abierto arriba y los nunca abiertos después, en el orden de siempre", async () => {
    const user = await makeUser();
    const p1 = await makeProject({ members: [user] });
    const p2 = await makeProject({ members: [user] });
    const p3 = await makeProject({ members: [user] });
    const ids = (list: { id: string }[]) => list.map((p) => p.id).filter((id) => [p1, p2, p3].some((f) => f.project.id === id));
    const me = asCurrent(user, "RECENT");
    // Sin aperturas: como antes (posición y fecha de creación).
    assert.deepEqual(ids(await listVisibleProjects(me)), [p1.project.id, p2.project.id, p3.project.id]);
    await noteProjectVisit(user.id, p2.project.id, new Date("2026-11-20T10:00:00.000Z"));
    await noteProjectVisit(user.id, p3.project.id, new Date("2026-11-20T11:00:00.000Z"));
    assert.deepEqual(ids(await listVisibleProjects(me)), [p3.project.id, p2.project.id, p1.project.id]);
    // Las aperturas de otra persona no cuentan.
    const other = await makeUser();
    await db.projectMember.create({ data: { projectId: p1.project.id, userId: other.id } });
    await noteProjectVisit(other.id, p1.project.id, new Date("2026-11-21T10:00:00.000Z"));
    assert.deepEqual(ids(await listVisibleProjects(me)), [p3.project.id, p2.project.id, p1.project.id]);
  });

  test("alfabético: sin distinguir mayúsculas ni acentos, y los números por su valor", async () => {
    const user = await makeUser();
    const names = ["Zeta", "árbol", "Arco", "Fase 10", "Fase 2", "Éxito"];
    const fixtures = [];
    for (const name of names) {
      const f = await makeProject({ members: [user] });
      await db.project.update({ where: { id: f.project.id }, data: { name } });
      fixtures.push(f);
    }
    const mine = new Set(fixtures.map((f) => f.project.id));
    const list = (await listVisibleProjects(asCurrent(user, "ALPHABETICAL"))).filter((p) => mine.has(p.id));
    assert.deepEqual(list.map((p) => p.name), ["árbol", "Arco", "Éxito", "Fase 2", "Fase 10", "Zeta"]);
    // Solo lo que la interfaz necesita (nada de las fechas de apertura).
    assert.deepEqual(Object.keys(list[0]!).sort(), ["id", "isPrivate", "name"]);
  });

  test("la preferencia se guarda, la lee la sesión y un valor desconocido se rechaza", async () => {
    const user = await makeUser();
    await loginAs(user);
    assert.equal((await getCurrentUser())?.projectOrder, "RECENT", "de serie, usados recientemente");
    expectOk(await updateProjectOrder("ALPHABETICAL"));
    assert.equal((await db.user.findUniqueOrThrow({ where: { id: user.id }, select: { projectOrder: true } })).projectOrder, "ALPHABETICAL");
    await loginAs(user);
    assert.equal((await getCurrentUser())?.projectOrder, "ALPHABETICAL");
    const bad = await updateProjectOrder("MANUAL" as never);
    assert.equal(bad.ok, false);
  });
});

describe("tareas vencidas para la página de Avisos", () => {
  test("cuenta las de «Mis tareas» con fecha antes de hoy: sin las de hoy, las hechas, las archivadas ni las de otros", async () => {
    const user = await makeUser();
    const other = await makeUser();
    const f = await makeProject({ members: [user, other] });
    const today = "2026-11-24";
    const mk = (opts: { due?: string; columnId?: string; assignee?: string; archived?: boolean }) =>
      makeTask(f, { dueDate: opts.due ? new Date(`${opts.due}T00:00:00.000Z`) : undefined, columnId: opts.columnId }).then((t) =>
        db.task.update({ where: { id: t.id }, data: { assigneeId: opts.assignee ?? user.id, archivedAt: opts.archived ? new Date() : null } }),
      );
    await mk({ due: "2026-11-23" });
    await mk({ due: "2026-10-01" });
    await mk({ due: today });
    await mk({});
    await mk({ due: "2026-11-01", columnId: f.columns.done });
    await mk({ due: "2026-11-01", archived: true });
    await mk({ due: "2026-11-01", assignee: other.id });
    const me = asCurrent(user, "RECENT");
    assert.equal(await overdueMyTasksCount(me, today), 2);
    // Si deja de ver el proyecto, tampoco cuentan.
    await db.projectMember.deleteMany({ where: { projectId: f.project.id, userId: user.id } });
    assert.equal(await overdueMyTasksCount(me, today), 0);
  });
});
