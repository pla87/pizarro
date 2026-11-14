// Escenario 6: archivar / recuperar, duplicar y borrar, con deshacer y rehacer.
import * as L from "./lib.mjs";
import * as U from "./ui.mjs";
const { COL } = L;

const full = async (title) => (await L.q(`SELECT t.id,t.title,t.description,t."kindId",t."assigneeId",t."dueDate"::text AS due,t."deliverableId",t.color,t.position,t."archivedAt" IS NOT NULL AS archived,t."archivedFromColumnId" AS "from",c.name AS col,
  (SELECT string_agg(l.name,',' ORDER BY l.name) FROM "TaskLabel" tl JOIN "Label" l ON l.id=tl."labelId" WHERE tl."taskId"=t.id) AS labels,
  (SELECT string_agg(s.title||':'||s.done,',' ORDER BY s.position) FROM "Subtask" s WHERE s."taskId"=t.id) AS subs
  FROM "Task" t JOIN "Column" c ON c.id=t."columnId" WHERE t.title=$1 ORDER BY t."createdAt"`, [title]));
const count = async (title) => (await full(title)).length;

export async function run() {
  L.scenario("6. Archivar / recuperar, duplicar y borrar con deshacer");
  await L.cleanBoard();
  const p0 = await L.project();
  await L.q(`INSERT INTO "Label"(id,"projectId",name,color) VALUES ('qlab1',$1,'Urgente','#ef4444')`, [p0.id]);
  const [, b] = await L.seedTasks(COL.doing, ["T1", "T2", "T3", "T4"]);
  const [u2] = await L.q(`SELECT id FROM "User" WHERE email=$1`, [L.USER2]);
  const [deliv] = await L.q(`SELECT id FROM "Deliverable" LIMIT 1`);
  await L.q(`UPDATE "Task" SET description='Descripción **rica**', "assigneeId"=$2, "dueDate"='2026-12-24', "deliverableId"=$3, color='#ef4444', "kindId"='kind_correccion' WHERE id=$1`, [b, u2.id, deliv.id]);
  await L.q(`INSERT INTO "TaskLabel"("taskId","labelId") VALUES ($1,'qlab1')`, [b]);
  await L.q(`INSERT INTO "Subtask"(id,"taskId",title,done,position) VALUES ('qd1',$1,'Sub uno',true,1024),('qd2',$1,'Sub dos',false,2048)`, [b]);
  const t0 = await L.dbNow();
  const s = await L.session({ viewport: U.WIDE });
  const p = s.page;
  const pos2 = Number((await full("T2"))[0].position);

  // --- archivar desde el diálogo ---
  await U.openTask(p, "T2");
  await U.dialog(p).getByRole("button", { name: "Archivar", exact: true }).click();
  await L.eqEventually("archivar: archivedAt y columna de origen en BD", async () => { const t = (await full("T2"))[0]; return t.archived && t.col === COL.doing && !!t.from; }, true);
  // Archivar desde el diálogo no es optimista: el diálogo se cierra y la tarjeta sale al responder el servidor, que
  // responde después de guardar en la BD.
  await L.checkEventually("archivar: el diálogo se cierra", async () => (await p.locator("[role=dialog]").count()) === 0);
  await L.eqEventually("archivar: sale del tablero (UI)", () => U.uiOrder(p, COL.doing), ["T1", "T3", "T4"]);
  L.eq("archivar: sale de la lista activa (BD)", await L.dbOrder(COL.doing), ["T1", "T3", "T4"]);
  await L.checkEventually("archivar: evento «archive»", async () => { const ev = await L.events("T2"); return [ev.some((e) => e.code === "archive"), ev]; });
  await U.logHas("archivar: AppLog", t0, "tasks.archiveTask", "Archivó «T2»");
  // deshacer
  await U.undoKey(p, "Control+z");
  await L.eqEventually("deshacer archivar: vuelve activa", async () => (await full("T2"))[0].archived, false);
  L.eq("deshacer archivar: misma columna y posición", [(await full("T2"))[0].col, Number((await full("T2"))[0].position)], [COL.doing, pos2]);
  L.eq("deshacer archivar: orden", await L.dbOrder(COL.doing), ["T1", "T2", "T3", "T4"]);
  await L.eqEventually("deshacer archivar: UI", () => U.uiOrder(p, COL.doing), ["T1", "T2", "T3", "T4"]);
  await U.undoKey(p, "Alt+Shift+z", "REDO");
  await L.eqEventually("rehacer archivar: archivada otra vez", async () => (await full("T2"))[0].archived, true);

  // --- recuperar desde «Archivadas» ---
  await p.getByRole("button", { name: "Archivadas" }).first().click();
  const arch = p.locator("[role=dialog]").first();
  await arch.getByText("T2").first().waitFor();
  L.check("archivadas: lista T2 «de «En progreso»»", /de «En progreso»/.test(await arch.innerText()));
  await arch.getByRole("button", { name: "Recuperar" }).first().click();
  await L.eqEventually("recuperar: activa de nuevo", async () => (await full("T2"))[0].archived, false);
  const rec = (await full("T2"))[0];
  L.eq("recuperar: vuelve a su columna", rec.col, COL.doing);
  L.check("recuperar: va al final de la columna", Number(rec.position) > Number((await full("T4"))[0].position), String(rec.position));
  L.check("recuperar: archivedFromColumnId limpiado", rec.from === null);
  await L.checkEventually("recuperar: evento «restore»", async () => { const ev = await L.events("T2"); return [ev.some((e) => e.code === "restore"), ev]; });
  await U.logHas("recuperar: AppLog", t0, "tasks.restoreTask", /^Recuperó «T2» en «En progreso»$/);
  await U.closeDialog(p);
  await L.eqEventually("recuperar: UI (al final)", () => U.uiOrder(p, COL.doing), ["T1", "T3", "T4", "T2"]);
  await U.undoKey(p, "Control+z");
  await L.eqEventually("deshacer recuperar: vuelve a estar archivada", async () => (await full("T2"))[0].archived, true);
  await U.undoKey(p, "Control+z"); // deshace el archivado rehecho -> activa en su sitio
  await L.eqEventually("deshacer archivar (otra vez): activa en su posición original", async () => { const t = (await full("T2"))[0]; return !t.archived && Number(t.position) === pos2; }, true);

  // --- duplicar (botón del diálogo) ---
  await U.openTask(p, "T2");
  await U.dialog(p).getByRole("button", { name: "Duplicar", exact: true }).click();
  await L.eqEventually("duplicar: nace «T2 (copia)»", () => count("T2 (copia)"), 1);
  const cp = (await full("T2 (copia)"))[0], orig = (await full("T2"))[0];
  L.eq("duplicar: copia en la misma columna", cp.col, COL.doing);
  L.check("duplicar: copia entre la original y la siguiente", Number(cp.position) > Number(orig.position) && Number(cp.position) < Number((await full("T3"))[0].position), `${orig.position} < ${cp.position}`);
  L.eq("duplicar: campos copiados", [cp.description.trim(), cp.kindId, cp.assigneeId, cp.due, cp.deliverableId, cp.color, cp.labels], [orig.description.trim(), orig.kindId, orig.assigneeId, orig.due, orig.deliverableId, orig.color, orig.labels]);
  L.eq("duplicar: subtareas copiadas con el estado sin marcar", cp.subs, "Sub uno:false,Sub dos:false");
  L.eq("duplicar: la original no cambia (subtareas)", orig.subs, "Sub uno:true,Sub dos:false");
  await U.logHas("duplicar: AppLog", t0, "tasks.duplicateTask", "Duplicó «T2»");
  await U.closeDialog(p);
  await L.eqEventually("duplicar: UI en la posición siguiente", async () => (await U.uiOrder(p, COL.doing)).slice(0, 4), ["T1", "T2", "T2 (copia)", "T3"]);
  await U.undoKey(p, "Control+z");
  await L.eqEventually("deshacer duplicar: la copia desaparece", () => count("T2 (copia)"), 0);
  await U.undoKey(p, "Alt+Shift+z", "REDO");
  await L.eqEventually("rehacer duplicar: la copia vuelve", () => count("T2 (copia)"), 1);
  await U.undoKey(p, "Control+z");
  await L.eqEventually("deshacer otra vez", () => count("T2 (copia)"), 0);
  // atajo Alt+Mayús+D con la tarjeta enfocada
  await L.cardLoc(p, "T3").focus();
  await p.keyboard.press("Alt+Shift+D");
  await L.eqEventually("Alt+Mayús+D duplica la tarjeta enfocada", () => count("T3 (copia)"), 1);
  // La copia llega al tablero con la respuesta del servidor (después de crearse en la BD).
  await L.eqEventually("Alt+Mayús+D: UI", async () => (await U.uiOrder(p, COL.doing)).slice(2, 4), ["T3", "T3 (copia)"]);
  await U.undoKey(p, "Control+z");
  await L.eqEventually("deshacer el duplicado por atajo", () => count("T3 (copia)"), 0);

  // --- borrar desde el diálogo con confirmación ---
  const before = (await full("T2"))[0];
  await U.openTask(p, "T2");
  await U.dialog(p).getByRole("button", { name: "Borrar", exact: true }).first().click();
  const confirm = p.locator("[role=dialog]").last();
  await confirm.getByText("¿Borrar definitivamente esta tarea y sus adjuntos?").waitFor();
  // Cancelar no borra
  await confirm.getByRole("button", { name: /Cancelar/ }).click();
  await L.sleep(400);
  L.eq("borrar: cancelar no borra", await count("T2"), 1);
  await U.dialog(p).getByRole("button", { name: "Borrar", exact: true }).first().click();
  await p.locator("[role=dialog]").last().getByRole("button", { name: "Borrar", exact: true }).click();
  await L.eqEventually("borrar: desaparece de la BD", () => count("T2"), 0);
  L.eq("borrar: sus subtareas y etiquetas desaparecen (cascada)", Number((await L.q(`SELECT count(*) AS n FROM "Subtask" WHERE "taskId"=$1`, [before.id]))[0].n) + Number((await L.q(`SELECT count(*) AS n FROM "TaskLabel" WHERE "taskId"=$1`, [before.id]))[0].n), 0);
  await L.eqEventually("borrar: UI sin la tarjeta", async () => (await U.uiOrder(p, COL.doing)).includes("T2"), false);
  await U.logHas("borrar: AppLog", t0, "tasks.deleteTask", /T2/);
  await U.undoKey(p, "Control+z");
  await L.eqEventually("deshacer borrar: la tarea vuelve", () => count("T2"), 1);
  const back = (await full("T2"))[0];
  L.eq("deshacer borrar: datos restaurados (descripción, tipo, responsable, fecha, entregable, color, etiquetas, subtareas, columna)",
    [back.description, back.kindId, back.assigneeId, back.due, back.deliverableId, back.color, back.labels, back.subs, back.col],
    [before.description, before.kindId, before.assigneeId, before.due, before.deliverableId, before.color, before.labels, before.subs, before.col]);
  L.eq("deshacer borrar: posición original", Number(back.position), Number(before.position));
  await L.eqEventually("deshacer borrar: UI vuelve a su sitio", () => U.uiOrder(p, COL.doing), ["T1", "T2", "T3", "T4"]);
  await U.undoKey(p, "Alt+Shift+z", "REDO");
  await L.eqEventually("rehacer borrar: borrada otra vez", () => count("T2"), 0);
  await U.undoKey(p, "Control+z");
  await L.eqEventually("deshacer borrar (2ª vez)", () => count("T2"), 1);

  // --- archivar y borrar varias a la vez (barra de selección) ---
  await L.reload(p);
  for (const t of ["T1", "T3"]) await L.cardLoc(p, t).locator("button[aria-label='Seleccionar']").click();
  await p.getByRole("button", { name: "Archivar", exact: true }).last().click();
  await L.eqEventually("archivar varias: ambas archivadas", async () => (await full("T1"))[0].archived && (await full("T3"))[0].archived, true);
  await L.eqEventually("archivar varias: UI", () => U.uiOrder(p, COL.doing), ["T2", "T4"]);
  await U.undoKey(p, "Control+z");
  await L.eqEventually("deshacer archivar varias: ambas activas en su sitio", () => L.dbOrder(COL.doing), ["T1", "T2", "T3", "T4"]);
  for (const t of ["T2", "T4"]) await L.cardLoc(p, t).locator("button[aria-label='Seleccionar']").click();
  await p.getByRole("button", { name: "Borrar", exact: true }).last().click();
  await p.locator("[role=dialog]").last().getByRole("button", { name: "Borrar", exact: true }).click();
  await L.eqEventually("borrar varias: ambas borradas", async () => (await count("T2")) + (await count("T4")), 0);
  await L.eqEventually("borrar varias: UI", () => U.uiOrder(p, COL.doing), ["T1", "T3"]);
  await U.undoKey(p, "Control+z");
  await L.eqEventually("deshacer borrar varias: vuelven las dos", () => L.dbOrder(COL.doing), ["T1", "T2", "T3", "T4"]);

  // --- archivar con Alt+A desde el diálogo ---
  await U.openTask(p, "T4");
  await p.keyboard.press("Alt+a");
  await L.eqEventually("Alt+A archiva la tarea abierta", async () => (await full("T4"))[0].archived, true);
  await U.undoKey(p, "Control+z");
  await L.eqEventually("deshacer Alt+A", async () => (await full("T4"))[0].archived, false);

  L.assertNoErrors("escenario 6", [s]);
  await s.ctx.close();
}
await U.runStandalone(import.meta.url, run);
