// Registro de actividad contra PostgreSQL real: un evento con NUL o medio emoji no bloquea a los demás (antes el lote
// entero fallaba y volvía a la cola para siempre), las filas que la base no admite se descartan y solo se reintenta lo
// que falla por la conexión.
import assert from "node:assert/strict";
import { beforeEach, describe, test } from "node:test";
import type { Prisma } from "../../src/generated/prisma/client";
import { db, expectOk, loginAs, makeKind, makeProject, makeTask, makeUser } from "./helpers";
import { POST } from "../../src/app/api/client-errors/route";
import { flushLogs, logEvent } from "../../src/lib/log";
import { logDetailsShown, logMessageText } from "../../src/lib/log-message";
import { makeT } from "../../src/i18n/core";
import { resetRateLimit } from "../../src/lib/rate-limit";
import { createProject } from "../../src/actions/projects";
import { updateTask } from "../../src/actions/tasks";
import { logText } from "../../src/lib/log";
import { andList } from "../../src/lib/undo-label";
import { LOG_LABEL_KEY } from "../../src/lib/log-message";

const state = (globalThis as unknown as { __pzLog: { queue: Prisma.AppLogCreateManyInput[]; lastPurge: number } }).__pzLog;
const jar = (globalThis as unknown as { __pzTestRequest: { jar: Map<string, string> } }).__pzTestRequest.jar;

function report(body: unknown) {
  const origin = new URL(process.env.APP_URL ?? "http://localhost:3000").origin;
  return POST(new Request(`${origin}/api/client-errors`, { method: "POST", headers: { origin, "x-real-ip": "10.7.7.7", "content-type": "application/json" }, body: JSON.stringify(body) }));
}

const rows = (tag: string) => db.appLog.findMany({ where: { action: { startsWith: tag } }, orderBy: { action: "asc" } });

beforeEach(async () => {
  jar.clear();
  resetRateLimit("client-errors:ip:10.7.7.7");
  resetRateLimit("client-errors:anon:10.7.7.7");
  await flushLogs();
  state.queue.length = 0;
  await db.appLog.deleteMany({ where: { OR: [{ category: "test" }, { category: "client", message: { contains: "fallo-" } }] } });
});

describe("logs con NUL o medio emoji", () => {
  test("un error del navegador sin sesión con \\u0000 y otro con \\ud83d se guardan (limpios) junto a los demás", async () => {
    assert.equal((await report({ source: "window", message: "fallo-nul a\u0000b", path: "/login" })).status, 204);
    assert.equal((await report({ source: "window", message: "fallo-emoji x\ud83d", stack: "pila \ud83d\u0000 rota" })).status, 204);
    assert.equal((await report({ source: "window", message: "fallo-normal 😀" })).status, 204);
    await flushLogs();
    const saved = await db.appLog.findMany({ where: { category: "client", message: { contains: "fallo-" } } });
    const by = (s: string) => saved.find((r) => r.message.includes(s));
    assert.equal(saved.length, 3);
    assert.match(by("fallo-nul")!.message, /fallo-nul ab$/);
    assert.match(by("fallo-emoji")!.message, /fallo-emoji x�$/);
    assert.equal((by("fallo-emoji")!.details as { stack: string }).stack, "pila � rota");
    assert.match(by("fallo-normal")!.message, /😀$/);
    assert.equal(state.queue.length, 0);
  });

  test("todos los campos y las claves de los detalles se limpian; los recortes no parten emojis", async () => {
    logEvent({
      category: "test\u0000", action: "logclean.a\u0000", message: "m\u0000", userName: "Ana\u0000\ud83d", path: "/p\u0000", ip: "1.2.3.4\u0000",
      details: { "clave\u0000": "v\u0000", "k\ud83d": ["x\ud83d"], largo: "😀".repeat(400), anidado: { "pass\u0000word": "secreto" } },
    });
    logEvent({ category: "test", action: "logclean.b", message: `a${"😀".repeat(600)}` });
    await flushLogs();
    const [a, b] = await rows("logclean.");
    assert.ok(a && b);
    assert.equal(a.category, "test");
    assert.equal(a.action, "logclean.a");
    assert.equal(a.message, "m");
    assert.equal(a.userName, "Ana�");
    assert.equal(a.path, "/p");
    assert.equal(a.ip, "1.2.3.4");
    const d = a.details as Record<string, unknown>;
    assert.equal(d["clave"], "v");
    assert.deepEqual(d["k�"], ["x�"]);
    assert.ok((d.largo as string).startsWith("😀") && (d.largo as string).includes("(800 caracteres)"));
    assert.ok((d.largo as string).isWellFormed());
    // La clave limpia sigue siendo la de una contraseña: se oculta.
    assert.deepEqual(d.anidado, { password: "[oculto]" });
    assert.equal(b.message.length, 999); // el emoji que no cabía entero se queda fuera
    assert.ok(b.message.isWellFormed());
  });
});

describe("guardado del lote", () => {
  test("una fila que la base rechaza se descarta y las demás se guardan; nada vuelve a la cola", async () => {
    const base = { level: "info", category: "test", message: "" };
    // Filas sin pasar por logEvent (que ya limpia): así la base las rechaza de verdad.
    state.queue.push(
      { ...base, action: "logbad.1-ok" },
      { ...base, action: "logbad.2-nul", message: "a\u0000b" },
      { ...base, action: "logbad.3-json", details: { a: "x\ud83d" } },
      { ...base, action: "logbad.4-jsonnul", details: { a: "x\u0000" } },
      { ...base, action: "logbad.5-ok" },
    );
    const errors: unknown[][] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => void errors.push(args);
    try {
      await flushLogs();
    } finally {
      console.error = original;
    }
    assert.deepEqual((await rows("logbad.")).map((r) => r.action), ["logbad.1-ok", "logbad.5-ok"]);
    assert.equal(state.queue.length, 0, "las filas malas no se reintentan");
    assert.equal(errors.filter((e) => String(e[0]).includes("evento descartado")).length, 3);
    // Y el registro sigue funcionando después.
    logEvent({ category: "test", action: "logbad.6-after" });
    await flushLogs();
    assert.equal((await rows("logbad.6")).length, 1);
  });

  test("si falla la conexión el lote vuelve a la cola y se guarda (una sola vez) en el siguiente intento", async () => {
    const delegate = db.appLog as unknown as { createMany: (...a: unknown[]) => Promise<unknown> };
    const original = delegate.createMany;
    const down = Object.assign(new Error("Can't reach database server"), {
      name: "PrismaClientKnownRequestError", code: "P1001", meta: { driverAdapterError: { cause: { kind: "DatabaseNotReachable" } } },
    });
    delegate.createMany = async () => { throw down; };
    const errors: unknown[][] = [];
    const log = console.error;
    console.error = (...args: unknown[]) => void errors.push(args);
    try {
      logEvent({ category: "test", action: "logconn.1" });
      logEvent({ category: "test", action: "logconn.2" });
      await flushLogs();
    } finally {
      delegate.createMany = original;
      console.error = log;
    }
    assert.ok(errors.length >= 1);
    assert.equal(state.queue.length, 2, "vuelven a la cola");
    assert.equal((await rows("logconn.")).length, 0);
    await flushLogs();
    assert.deepEqual((await rows("logconn.")).map((r) => r.action), ["logconn.1", "logconn.2"]);
    assert.equal(state.queue.length, 0);
  });

  test("un fallo al purgar los antiguos no vuelve a encolar (ni duplica) lo ya guardado", async () => {
    const delegate = db.appLog as unknown as { deleteMany: (...a: unknown[]) => Promise<unknown> };
    const original = delegate.deleteMany;
    delegate.deleteMany = async () => { throw new Error("Connection terminated unexpectedly"); };
    const log = console.error;
    console.error = () => {};
    try {
      state.lastPurge = 0;
      logEvent({ category: "test", action: "logpurge.1" });
      await flushLogs();
    } finally {
      delegate.deleteMany = original;
      console.error = log;
    }
    assert.equal(state.queue.length, 0);
    await flushLogs();
    assert.equal((await rows("logpurge.")).length, 1);
  });

  // Carrera vista con la CPU cargada: el temporizador ya había sacado el lote de la cola y lo estaba guardando, y
  // flushLogs volvía en el acto (cola vacía) sin esperar esa escritura: quien leía después no encontraba las filas.
  test("flushLogs espera también a la escritura que ya está en curso", async () => {
    logEvent({ category: "test", action: "lograce.1" });
    const timerFlush = flushLogs(); // como el temporizador: el lote sale de la cola y empieza a guardarse
    assert.equal(state.queue.length, 0);
    logEvent({ category: "test", action: "lograce.2" });
    await flushLogs();
    assert.deepEqual((await rows("lograce.")).map((r) => r.action), ["lograce.1", "lograce.2"]);
    await timerFlush;
    // Sin nada pendiente, también espera a la que esté en curso.
    logEvent({ category: "test", action: "lograce.3" });
    void flushLogs();
    await flushLogs();
    assert.equal((await rows("lograce.")).length, 3);
  });
});

describe("mensajes traducibles", () => {
  test("con plantilla: el mensaje se guarda en español y la página lo pinta en inglés; los detalles no la muestran", async () => {
    logEvent({ category: "test", action: "tlabel.login", label: { k: "{name} ha iniciado sesión", p: { name: "Ana" } }, details: { method: "password" } });
    logEvent({ category: "test", action: "tlabel.view", label: { k: "Visita a {path}", p: { path: "/api/calendar/secreto123.ics" } } });
    logEvent({ category: "test", action: "tlabel.plain", message: "Error inesperado. Inténtalo de nuevo." });
    await flushLogs();
    const [login, plain, view] = await rows("tlabel.");
    const en = makeT("en");
    assert.equal(login!.message, "Ana ha iniciado sesión");
    assert.equal(logMessageText(login!, en), "Ana signed in");
    assert.equal(logMessageText(login!, makeT("es")), "Ana ha iniciado sesión");
    assert.deepEqual(logDetailsShown(login!.details), { method: "password" });
    // Las variables, sin la credencial de la ruta (como el mensaje); sin otros detalles, «Sin detalles».
    assert.equal(logMessageText(view!, en), "Visit to /api/calendar/…");
    assert.equal(logDetailsShown(view!.details), null);
    // Sin plantilla, un texto fijo del diccionario se traduce; el texto libre sale tal cual.
    assert.equal(logMessageText(plain!, en), "Unexpected error. Please try again.");
    assert.equal(logMessageText({ message: "Visita libre", details: null }, en), "Visita libre");
  });

  // Los más vistos en un recorrido normal salían en español en los logs en inglés (crear proyecto, el segundo paso del
  // acceso, activar la verificación, subir archivos, el arranque).
  test("crear un proyecto, el acceso en dos pasos, las subidas y el arranque también se leen en inglés", async () => {
    const admin = await makeUser({ role: "ADMIN", name: "Admin Log" });
    await loginAs(admin);
    expectOk(await createProject("Casa log", { isPrivate: true }));
    await flushLogs();
    const created = await db.appLog.findFirstOrThrow({ where: { action: "projects.createProject", userId: admin.id }, orderBy: { createdAt: "desc" } });
    const en = makeT("en");
    assert.equal(created.message, "Creó el proyecto privado «Casa log»");
    assert.equal(logMessageText(created, en), "Created the private project “Casa log”");

    logEvent({ category: "test", action: "tlabel2.second", label: { k: "{name}: contraseña correcta, falta la verificación en dos pasos", p: { name: "Ana" } } });
    logEvent({ category: "test", action: "tlabel2.totp", label: { k: "{name} ha activado la verificación en dos pasos ({method})", p: { name: "Ana", method: "TOTP" } } });
    logEvent({ category: "test", action: "tlabel2.upload", label: { k: "Archivo «{name}» subido ({size})", p: { name: "nota.txt", size: "13 B" } } });
    logEvent({ category: "test", action: "tlabel2.fail", label: { k: "Inicio de sesión fallido ({email}): {why}", p: { email: { k: "[no es un email]" }, why: { k: "contraseña incorrecta" } } } });
    await flushLogs();
    const [fail, second, totp, upload] = await rows("tlabel2.");
    assert.equal(second!.message, "Ana: contraseña correcta, falta la verificación en dos pasos");
    assert.equal(logMessageText(second!, en), "Ana: correct password, two-step verification pending");
    assert.equal(logMessageText(totp!, en), "Ana turned on two-step verification (TOTP)");
    assert.equal(logMessageText(upload!, en), "File “nota.txt” uploaded (13 B)");
    assert.equal(fail!.message, "Inicio de sesión fallido ([no es un email]): contraseña incorrecta");
    assert.equal(logMessageText(fail!, en), "Failed sign-in ([not an email]): wrong password");
    // El arranque (scripts/boot.ts) escribe la fila directamente, con la plantilla en los detalles.
    const boot = { message: "Arranque de Pizarro v1.0.0", details: { version: "1.0.0", [LOG_LABEL_KEY]: { k: "Arranque de Pizarro v{version}", p: { version: "1.0.0" } } } };
    assert.equal(logMessageText(boot, en), "Pizarro v1.0.0 started");
    assert.deepEqual(logDetailsShown(boot.details), { version: "1.0.0" });
  });

  // Con la interfaz en inglés, editar dos campos salía «Edited “Obra: …”: […] and […]»: la lista anidada pasaba del tope
  // de profundidad de los detalles y se guardaba como «[…]».
  test("editar una tarjeta: los nombres de 1, 2 y 3 campos se leen en los dos idiomas", async () => {
    const admin = await makeUser({ role: "ADMIN", name: "Admin Campos" });
    await loginAs(admin);
    const f = await makeProject();
    const task = await makeTask(f, { title: "Obra: inicio" });
    const other = await makeKind(f.project.id);
    expectOk(await updateTask(task.id, { title: "Obra: uno" }));
    expectOk(await updateTask(task.id, { title: "Obra: dos", kindId: other.id }));
    expectOk(await updateTask(task.id, { title: "Obra: tres", kindId: f.kindId, color: "#ef4444" }));
    await flushLogs();
    const edits = await db.appLog.findMany({ where: { action: "tasks.updateTask", userId: admin.id }, orderBy: { createdAt: "asc" } });
    const en = makeT("en");
    assert.deepEqual(edits.map((r) => r.message), ["Modificó «Obra: uno»: título", "Modificó «Obra: dos»: título y tipo", "Modificó «Obra: tres»: título, tipo y color"]);
    assert.deepEqual(edits.map((r) => logMessageText(r, en)), ["Edited “Obra: uno”: title", "Edited “Obra: dos”: title and type", "Edited “Obra: tres”: title, type and color"]);
  });

  test("copias, apagado, emails, PDF y exportar: guardados en español y leídos en inglés, con los motivos traducidos", async () => {
    // Las mismas plantillas que escriben backup.ts, shutdown.ts, mail.ts, las rutas de PDF y transfer-jobs.ts.
    logEvent({ category: "test", action: "tsample.backupFailed", label: { k: "Falló la copia de seguridad: {error}", p: { error: logText("No hay espacio suficiente en el disco del servidor para esta operación.") } } });
    logEvent({
      category: "test", action: "tsample.restore",
      label: { k: "Prueba de restauración correcta: {file} ({rows} filas en {tables} tablas, {objects} ficheros comprobados)", p: { file: "pizarro-2026-11-23.tar", rows: "120", tables: "30", objects: 4 } },
    });
    logEvent({ category: "test", action: "tsample.shutdown", label: { k: "Apagado ordenado ({signal}): sin peticiones ni envíos pendientes", p: { signal: "SIGTERM" } } });
    logEvent({
      category: "test", action: "tsample.shutdownLeft",
      label: { k: "Apagado ordenado ({signal}): {left} tras {seconds} s", p: { signal: "SIGTERM", seconds: 10, left: andList([{ k: "{n} conexión(es) con peticiones sin terminar", p: { n: 2 } }, { k: "{n} envío(s) de email sin terminar", p: { n: 1 } }]) } },
    });
    logEvent({ category: "test", action: "tsample.mail", label: { k: "Email enviado: {what}", p: { what: logText("aviso de contraseña cambiada") } } });
    logEvent({ category: "test", action: "tsample.pdf", label: { k: "Informe PDF generado de «{project}» ({size})", p: { project: "Casa", size: "120 KB" } } });
    logEvent({ category: "test", action: "tsample.import", label: { k: "Proyecto «{name}» importado desde {source} ({tasks} tareas, {size})", p: { name: "Casa", source: { k: "un CSV" }, tasks: 3, size: "2 KB" } } });
    // Un error tal cual (de una biblioteca) sale sin traducir, y sin la credencial de una ruta.
    logEvent({ category: "test", action: "tsample.raw", label: { k: "Fallo al servir el calendario suscrito: {error}", p: { error: logText("ECONNRESET en /api/calendar/secreto123.ics") } } });
    await flushLogs();
    const by = Object.fromEntries((await rows("tsample.")).map((r) => [r.action.slice("tsample.".length), r]));
    const en = makeT("en");
    const both = (key: string) => [by[key]!.message, logMessageText(by[key]!, en)];
    assert.deepEqual(both("backupFailed"), ["Falló la copia de seguridad: No hay espacio suficiente en el disco del servidor para esta operación.", `Backup failed: ${en("No hay espacio suficiente en el disco del servidor para esta operación.")}`]);
    assert.notEqual(en("No hay espacio suficiente en el disco del servidor para esta operación."), "No hay espacio suficiente en el disco del servidor para esta operación.");
    assert.deepEqual(both("restore"), [
      "Prueba de restauración correcta: pizarro-2026-11-23.tar (120 filas en 30 tablas, 4 ficheros comprobados)",
      "Restore test passed: pizarro-2026-11-23.tar (120 rows in 30 tables, 4 files checked)",
    ]);
    assert.deepEqual(both("shutdown"), ["Apagado ordenado (SIGTERM): sin peticiones ni envíos pendientes", "Graceful shutdown (SIGTERM): no pending requests or sends"]);
    assert.deepEqual(both("shutdownLeft"), [
      "Apagado ordenado (SIGTERM): 2 conexión(es) con peticiones sin terminar y 1 envío(s) de email sin terminar tras 10 s",
      "Graceful shutdown (SIGTERM): 2 connection(s) with unfinished requests and 1 unfinished email send(s) after 10 s",
    ]);
    assert.deepEqual(both("mail"), ["Email enviado: aviso de contraseña cambiada", "Email sent: notice of password changed"]);
    assert.deepEqual(both("pdf"), ["Informe PDF generado de «Casa» (120 KB)", "PDF report generated for “Casa” (120 KB)"]);
    assert.deepEqual(both("import"), ["Proyecto «Casa» importado desde un CSV (3 tareas, 2 KB)", "Project “Casa” imported from a CSV (3 tasks, 2 KB)"]);
    assert.deepEqual(both("raw"), ["Fallo al servir el calendario suscrito: ECONNRESET en /api/calendar/…", "Failed to serve the subscribed calendar: ECONNRESET en /api/calendar/…"]);
    assert.ok(!JSON.stringify(by.raw!.details).includes("secreto123"));
  });
});
