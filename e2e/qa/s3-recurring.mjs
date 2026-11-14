// Escenario 3: una tarea recurrente que llega a una columna terminada crea la siguiente aparición; deshacer la quita.
import * as L from "./lib.mjs";
import * as U from "./ui.mjs";
const { COL } = L;

const copies = (title) => L.q(`SELECT t.id,t.title,t."recurrenceFromId",t.recurrence,t."recurrenceDay",t."dueDate"::text AS due,t.position,t."assigneeId",c.name AS col,
  (SELECT count(*) FROM "Subtask" s WHERE s."taskId"=t.id AND s.done) AS done, (SELECT count(*) FROM "Subtask" s WHERE s."taskId"=t.id) AS subs
  FROM "Task" t JOIN "Column" c ON c.id=t."columnId" WHERE t.title=$1 ORDER BY t."createdAt", t.id`, [title]);

export async function run() {
  L.scenario("3. Tarea recurrente al llegar a una columna terminada");
  await L.cleanBoard();
  const [r] = await L.seedTasks(COL.doing, ["Informe semanal"]);
  await L.seedTasks(COL.backlog, ["Fija1", "Fija2"]);
  const [adm] = await L.q(`SELECT id FROM "User" WHERE email=$1`, [L.ADMIN]);
  await L.q(`UPDATE "Task" SET "assigneeId"=$2, "dueDate"=CURRENT_DATE WHERE id=$1`, [r, adm.id]);
  await L.q(`INSERT INTO "Subtask"(id,"taskId",title,done,position) VALUES ('qs1',$1,'Hecha',true,1024),('qs2',$1,'Pendiente',false,2048)`, [r]);
  const t0 = await L.dbNow();
  const s = await L.session({ viewport: U.WIDE });
  const p = s.page;

  // Fijar la repetición desde el diálogo
  await U.openTask(p, "Informe semanal");
  const rep = U.dialog(p).locator("select").filter({ has: p.locator("option", { hasText: "No se repite" }) });
  await rep.selectOption({ label: "Cada día" });
  await L.eqEventually("repetición diaria guardada en BD", async () => (await L.dbTask("Informe semanal")).recurrence, "DAILY");
  await U.closeDialog(p);
  L.check("la tarjeta muestra el icono de repetición", (await L.cardLoc(p, "Informe semanal").locator("svg[aria-label]").count()) > 0);

  // Mover a una columna NO terminada: no nace nada
  await U.drag(p, "Informe semanal", { card: "Fija1", where: "top" });
  await L.eqEventually("mover a una columna no terminada: sigue habiendo una sola tarea", async () => (await copies("Informe semanal")).length, 1);
  L.eq("la tarea está en Backlog", (await copies("Informe semanal"))[0].col, COL.backlog);

  // Mover a una terminada (arrastre)
  await U.drag(p, "Informe semanal", { column: COL.closed });
  await L.eqEventually("al terminarla nace la siguiente aparición", async () => (await copies("Informe semanal")).length, 2);
  const [orig, next] = await copies("Informe semanal");
  L.eq("la original está en Cerrado", orig.col, COL.closed);
  L.eq("la copia está en la primera columna no terminada (Backlog)", next.col, COL.backlog);
  L.eq("la copia apunta a la original (recurrenceFromId)", next.recurrenceFromId, orig.id);
  L.eq("la copia conserva la repetición", [next.recurrence, next.recurrenceDay], ["DAILY", null]);
  L.check("la copia lleva fecha límite posterior a hoy (regla diaria)", next.due > orig.due, `${orig.due} -> ${next.due}`);
  L.eq("la copia conserva el responsable", next.assigneeId, adm.id);
  L.eq("la copia tiene las subtareas sin marcar", [Number(next.subs), Number(next.done)], [2, 0]);
  L.check("la copia va al final de Backlog", Number(next.position) > Number((await L.dbTask("Fija2")).position), `${next.position}`);
  L.eq("orden de Backlog: Fija1, Fija2, copia", (await L.dbOrder(COL.backlog)).length, 3);
  // La copia llega al tablero con la respuesta del servidor (después de crearse en la BD).
  await L.eqEventually("la UI muestra la copia sin recargar", async () => (await U.uiOrder(p, COL.backlog)).filter((t) => t === "Informe semanal").length, 1);
  L.eq("la UI muestra la original en Cerrado", await U.uiOrder(p, COL.closed), ["Informe semanal"]);
  await L.checkEventually("evento «done» registrado para la original", async () => { const ev = (await L.events("Informe semanal")).filter((e) => e.code === "done"); return [ev.length === 1, ev]; });
  await U.logHas("AppLog del movimiento", t0, "tasks.moveTask", "Movió «Informe semanal» de «Backlog» a «Cerrado»");

  // Idempotencia: moverla entre dos terminadas no crea otra
  await U.drag(p, "Informe semanal", { column: COL.prod }, COL.closed);
  await L.eqEventually("entre dos columnas terminadas no nace otra", async () => (await L.dbTask("Informe semanal")).columnName === COL.prod || (await copies("Informe semanal")).some((c) => c.col === COL.prod), true);
  L.eq("sigue habiendo dos tareas", (await copies("Informe semanal")).length, 2);
  await U.undoKey(p, "Control+z");
  await L.eqEventually("deshacer el movimiento entre terminadas: vuelve a Cerrado", async () => (await copies("Informe semanal"))[0].col, COL.closed);
  L.eq("deshacer (entre terminadas) no quita la copia", (await copies("Informe semanal")).length, 2);

  // Deshacer el movimiento que la creó
  await U.undoKey(p, "Control+z");
  await L.eqEventually("deshacer quita la copia", async () => (await copies("Informe semanal")).length, 1);
  const [o2] = await copies("Informe semanal");
  L.eq("deshacer: la original vuelve a Backlog", o2.col, COL.backlog);
  await L.eqEventually("deshacer: UI Backlog con la original y sin copia", async () => [(await U.uiOrder(p, COL.backlog)).filter((t) => t === "Informe semanal").length, await U.uiOrder(p, COL.closed)], [1, []]);
  await L.reload(p);
  L.eq("deshacer: tras recargar, una sola tarjeta", (await p.locator("[data-task-card]").filter({ has: p.locator("p", { hasText: /^Informe semanal$/ }) }).count()), 1);
  // Rehacer: vuelve a moverla y a crear la copia
  await U.undoKey(p, "Alt+Shift+z", "REDO");
  await L.eqEventually("rehacer: la original vuelve a Cerrado", async () => (await copies("Informe semanal")).find((c) => c.id === orig.id)?.col, COL.closed);
  const after = await copies("Informe semanal");
  L.note("rehacer: número de tareas «Informe semanal» tras rehacer el movimiento", String(after.length));
  L.eq("rehacer: la copia se vuelve a crear (2 tareas, sin duplicados)", after.length, 2);
  await U.undoKey(p, "Control+z");
  await L.eqEventually("deshacer otra vez: una sola", async () => (await copies("Informe semanal")).length, 1);

  // Mover con el select del diálogo y con la barra de selección también la crea
  await U.openTask(p, "Informe semanal");
  await U.dialog(p).locator("select").first().selectOption({ label: COL.closed });
  await L.eqEventually("diálogo: también nace la copia", async () => (await copies("Informe semanal")).length, 2);
  await U.closeDialog(p);
  await U.undoKey(p, "Control+z");
  await L.eqEventually("diálogo: deshacer quita la copia", async () => (await copies("Informe semanal")).length, 1);
  await L.reload(p);
  await L.cardLoc(p, "Informe semanal").locator("button[aria-label='Seleccionar']").click();
  await p.getByRole("button", { name: "Mover a…" }).or(p.locator("select").filter({ has: p.locator("option", { hasText: "Mover a…" }) })).first().selectOption({ label: COL.closed });
  await L.eqEventually("selección múltiple: también nace la copia", async () => (await copies("Informe semanal")).length, 2);
  const c3 = await copies("Informe semanal");
  L.eq("selección múltiple: la copia está en Backlog", c3[1].col, COL.backlog);
  await U.undoKey(p, "Control+z");
  await L.eqEventually("selección múltiple: deshacer quita la copia", async () => (await copies("Informe semanal")).length, 1);
  L.eq("selección múltiple: original en Backlog", (await copies("Informe semanal"))[0].col, COL.backlog);

  // Semanal: el día de la semana sale de la fecha límite
  await U.openTask(p, "Informe semanal");
  await rep.selectOption({ label: "Cada semana" });
  await L.eqEventually("semanal: recurrenceDay entre 1 y 7", async () => { const t = await L.dbTask("Informe semanal"); return t.recurrence === "WEEKLY" && t.recurrenceDay >= 1 && t.recurrenceDay <= 7; }, true);
  await rep.selectOption({ label: "No se repite" });
  await L.eqEventually("sin repetición: recurrence NONE y recurrenceDay nulo", async () => { const t = await L.dbTask("Informe semanal"); return [t.recurrence, t.recurrenceDay]; }, ["NONE", null]);
  await U.closeDialog(p);
  await U.drag(p, "Informe semanal", { column: COL.closed });
  await L.eqEventually("sin repetición: al terminarla no nace copia", async () => (await L.dbTask("Informe semanal")).columnName, COL.closed);
  await L.sleep(500);
  L.eq("sin repetición: una sola tarea", (await copies("Informe semanal")).length, 1);

  L.assertNoErrors("escenario 3", [s]);
  await s.ctx.close();
}
await U.runStandalone(import.meta.url, run);
