// Administración → Logs (página y descarga CSV) contra PostgreSQL real: filtros (un NUL en la URL no llega a la base, los
// comodines de LIKE se buscan literales), paginación por clave, tope y registro de la descarga, y lo que guarda una acción
// que falla antes de saber su proyecto.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { db, expectFail, loginAs, makeProject, makeTask, makeUser } from "./helpers";
import { logsAfter, logWhere, parseLogFilters } from "../../src/lib/log-query";
import { flushLogs, logEvent } from "../../src/lib/log";
import { logDetailsShown, logMessageText } from "../../src/lib/log-message";
import { updateAccent, updateLocale, updateTheme } from "../../src/actions/profile";
import { makeT } from "../../src/i18n/core";
import { resetRateLimit } from "../../src/lib/rate-limit";
import { updateTask } from "../../src/actions/tasks";
import { GET as logsCsv } from "../../src/app/api/admin/logs/route";

describe("filtros de logs con NUL", () => {
  test("categoría, persona y texto con \\u0000: se quita y la consulta funciona (antes, error 22021 y página de error)", async () => {
    const admin = await makeUser({ role: "ADMIN" });
    const action = `prueba.nul${Date.now()}`;
    await db.appLog.create({ data: { level: "warn", category: "nultest", action, message: "Un fallo de prueba", userId: admin.id, userName: admin.name } });
    const f = parseLogFilters({ category: "nul\u0000test", user: `${admin.id}\u0000`, q: "fa\u0000llo", consultas: "1" });
    const rows = await db.appLog.findMany({ where: logWhere(f, []) });
    assert.deepEqual(rows.map((r) => r.action), [action]);
    // El recuento por nivel (la otra consulta de la página) tampoco falla.
    const counts = await db.appLog.groupBy({ by: ["level"], where: logWhere(f, [], false), _count: { _all: true } });
    assert.deepEqual(counts.map((c) => [c.level, c._count._all]), [["warn", 1]]);
    // Solo NUL: como si no hubiera filtro.
    assert.deepEqual(parseLogFilters({ category: "\u0000", user: "\u0000", q: "\u0000" }), parseLogFilters({}));
  });

  test("descarga CSV con ?q=a%00b: responde entera (antes se cortaba la conexión a medias)", async () => {
    const admin = await makeUser({ role: "ADMIN" });
    await loginAs(admin);
    const action = `prueba.csv${Date.now()}`;
    await db.appLog.create({ data: { level: "warn", category: "nultest", action, message: "ab en el CSV", userId: admin.id, userName: admin.name } });
    const res = await logsCsv(new Request("http://localhost/api/admin/logs?q=a%00b&category=nul%00test"));
    assert.equal(res.status, 200);
    const text = await res.text();
    assert.match(text, new RegExp(action.replace(".", "\\.")));
  });
});

describe("búsqueda de texto en los logs", () => {
  test("«%» y «_» se buscan literales (antes casaban con cualquier cosa)", async () => {
    const tag = `like${Date.now()}`;
    await db.appLog.createMany({
      data: ["al 50% de carga", "500 peticiones", "a_b literal", "axb sin guion"].map((message, i) => ({ level: "warn", category: tag, action: `${tag}.${i}`, message })),
    });
    const found = async (q: string) =>
      (await db.appLog.findMany({ where: logWhere(parseLogFilters({ category: tag, q, consultas: "1" }), []), orderBy: { action: "asc" } })).map((r) => r.message);
    assert.deepEqual(await found("50%"), ["al 50% de carga"]);
    assert.deepEqual(await found("a_b"), ["a_b literal"]);
    assert.deepEqual(await found("%"), ["al 50% de carga"]);
    assert.deepEqual(await found("\\"), []);
  });
});

describe("búsqueda en el idioma de quien mira", () => {
  test("en inglés se busca en el mensaje en inglés; en las filas sin él (anteriores a la columna), en el español", async () => {
    const tag = `en${Date.now()}`;
    logEvent({ category: tag, action: `${tag}.label`, label: { k: "{name} ha iniciado sesión", p: { name: "Ana" } } });
    logEvent({ category: tag, action: `${tag}.fixed`, message: "Error inesperado. Inténtalo de nuevo." });
    logEvent({ category: tag, action: `${tag}.free`, message: "Texto libre sin traducción" });
    await flushLogs();
    // Fila de una versión anterior: sin messageEn.
    await db.appLog.create({ data: { level: "info", category: tag, action: `${tag}.old`, message: "Ana ha iniciado sesión (antigua)" } });
    const stored = await db.appLog.findMany({ where: { category: tag }, orderBy: { action: "asc" }, select: { action: true, message: true, messageEn: true } });
    assert.deepEqual(stored.map((r) => [r.action.slice(tag.length + 1), r.messageEn]), [
      ["fixed", "Unexpected error. Please try again."],
      ["free", null],
      ["label", "Ana signed in"],
      ["old", null],
    ]);
    const found = async (q: string, locale: "es" | "en") =>
      (await db.appLog.findMany({ where: logWhere({ ...parseLogFilters({ category: tag, q, consultas: "1" }), locale }, []), orderBy: { action: "asc" } })).map((r) => r.action.slice(tag.length + 1));
    assert.deepEqual(await found("signed in", "en"), ["label"]);
    assert.deepEqual(await found("SIGNED", "en"), ["label"]);
    assert.deepEqual(await found("signed in", "es"), []);
    // En inglés, el español de una fila con su traducción ya no casa; el de las que no la tienen, sí.
    assert.deepEqual(await found("iniciado sesión", "en"), ["old"]);
    assert.deepEqual(await found("iniciado sesión", "es"), ["label", "old"]);
    assert.deepEqual(await found("unexpected", "en"), ["fixed"]);
    assert.deepEqual(await found("texto libre", "en"), ["free"]);
    // La descarga CSV en inglés usa el mismo filtro.
    const admin = await makeUser({ role: "ADMIN" });
    await db.user.update({ where: { id: admin.id }, data: { locale: "EN" } });
    await loginAs(admin);
    const res = await logsCsv(new Request(`http://localhost/api/admin/logs?category=${tag}&q=signed&consultas=1`));
    const text = await res.text();
    assert.match(text, /Ana signed in/);
    assert.doesNotMatch(text, /antigua/);
  });
});

describe("paginación de los logs y descarga CSV", () => {
  test("por clave: con fechas repetidas no se salta ni se repite ninguna fila", async () => {
    const tag = `keyset${Date.now()}`;
    const t0 = Date.now() - 60_000;
    // Grupos de filas con la misma fecha (lo normal al escribir el registro por lotes).
    await db.appLog.createMany({ data: Array.from({ length: 23 }, (_, i) => ({ level: "warn", category: tag, action: `${tag}.${i}`, createdAt: new Date(t0 - Math.floor(i / 5) * 1000) })) });
    const where = logWhere(parseLogFilters({ category: tag }), []);
    const order = [{ createdAt: "desc" as const }, { id: "desc" as const }];
    const all = (await db.appLog.findMany({ where, orderBy: order, select: { id: true } })).map((r) => r.id);
    const seen: string[] = [];
    let last: { id: string; createdAt: Date } | null = null;
    for (;;) {
      const page: { id: string; createdAt: Date }[] = await db.appLog.findMany({ where: last ? { AND: [where, logsAfter(last)] } : where, orderBy: order, take: 4, select: { id: true, createdAt: true } });
      seen.push(...page.map((r) => r.id));
      if (page.length < 4) break;
      last = page.at(-1)!;
    }
    assert.equal(all.length, 23);
    assert.deepEqual(seen, all);
  });

  test("CSV de más de 200 000 filas: tiempo lineal (antes cada página recorría las anteriores) y aviso de recorte al final", { timeout: 300_000 }, async () => {
    const admin = await makeUser({ role: "ADMIN" });
    await loginAs(admin);
    const small = `csvsmall${Date.now()}`;
    const big = `csvbig${Date.now()}`;
    const insert = (category: string, n: number) =>
      db.$executeRawUnsafe(
        `INSERT INTO "AppLog" (id, "createdAt", level, category, action, message)
         SELECT '${category}' || lpad(g::text, 7, '0'), now() - interval '1 minute' - (g * interval '200 milliseconds'), 'warn', '${category}', 'prueba.csv', 'mensaje ' || g
         FROM generate_series(1, ${n}) g`,
      );
    await insert(small, 2_000);
    await insert(big, 200_005);
    await db.$executeRawUnsafe(`ANALYZE "AppLog"`);
    try {
      const download = async (category: string) => {
        resetRateLimit(`logs-csv:${admin.id}`);
        const t0 = performance.now();
        const res = await logsCsv(new Request(`http://localhost/api/admin/logs?category=${category}&q=mensaje`));
        assert.equal(res.status, 200);
        const text = await res.text();
        return { ms: performance.now() - t0, lines: text.split("\r\n") };
      };
      let ref = Infinity;
      for (let i = 0; i < 3; i++) {
        const d = await download(small);
        assert.equal(d.lines.length, 2_001);
        ref = Math.min(ref, d.ms);
      }
      // Cien veces más filas. Lineal: entre 45 y 70 veces lo de 2000 (lo fijo pesa más en la pequeña). Con el cursor de
      // Prisma cada página recorría las anteriores: unas 500 veces (22 s frente a 2,2 s; 81 s en una máquina más lenta).
      const max = ref * 200;
      let best = Infinity;
      let lines: string[] = [];
      for (let i = 0; i < 3 && best >= max; i++) {
        const d = await download(big);
        best = Math.min(best, d.ms);
        lines = d.lines;
      }
      assert.ok(best < max, `200 000 filas: ${Math.round(best)} ms; 2000: ${Math.round(ref)} ms (máximo ${Math.round(max)}, la mejor de tres)`);
      assert.equal(lines.length, 1 + 200_000 + 1);
      assert.match(lines.at(-1)!, /^"Recortado a 200.000 filas: acorta el intervalo\."$/);
      // Sin pasar del tope no hay aviso.
      assert.match(lines.at(-2)!, /prueba\.csv/);
    } finally {
      await db.appLog.deleteMany({ where: { category: { in: [small, big] } } });
    }
  });

  test("CSV: una a la vez por administrador, tope de 5 cada 10 minutos y registro sin datos personales", async () => {
    const admin = await makeUser({ role: "ADMIN" });
    await loginAs(admin);
    resetRateLimit(`logs-csv:${admin.id}`);
    // Más de una página (1000 filas): la descarga no termina hasta que se lea.
    const tag = `csvbusy${Date.now()}`;
    await db.appLog.createMany({ data: Array.from({ length: 1500 }, (_, i) => ({ level: "warn", category: tag, action: "prueba.csv", message: `texto-buscado ${i}`, userId: admin.id })) });
    const open = await logsCsv(new Request(`http://localhost/api/admin/logs?q=texto-buscado&user=${admin.id}&level=warn&category=${tag}`));
    assert.equal(open.status, 200);
    // Con la primera sin terminar, la segunda espera.
    const busy = await logsCsv(new Request("http://localhost/api/admin/logs"));
    assert.equal(busy.status, 429);
    assert.match(await busy.text(), /descarga de logs en curso/);
    // Cortada (el navegador cancela), queda libre.
    await open.body!.cancel();
    for (let i = 0; i < 4; i++) {
      const res = await logsCsv(new Request("http://localhost/api/admin/logs"));
      assert.equal(res.status, 200);
      await res.text();
    }
    const over = await logsCsv(new Request("http://localhost/api/admin/logs"));
    assert.equal(over.status, 429);
    assert.match(await over.text(), /Demasiadas descargas de logs/);
    resetRateLimit(`logs-csv:${admin.id}`);

    await flushLogs();
    const logged = await db.appLog.findMany({ where: { action: "admin.logsCsv", userId: admin.id }, orderBy: { createdAt: "asc" } });
    assert.equal(logged.length, 5);
    assert.equal(JSON.stringify(logged[0]).includes("texto-buscado"), false);
    assert.equal(JSON.stringify(logged[0]!.details).includes(admin.id), false);
    // Sin la plantilla del mensaje (se pinta traducida en la página; no sale en los detalles).
    assert.deepEqual({ ...(logDetailsShown(logged[0]!.details) as Record<string, unknown>), from: "", to: "" }, { from: "", to: "", level: "warn", category: tag, search: true, reads: false });
  });
});

describe("CSV de logs para Excel", () => {
  test("en español: BOM, «;» entre columnas y cabecera en español; en inglés: «,» y cabecera en inglés", async () => {
    const admin = await makeUser({ role: "ADMIN" });
    await loginAs(admin);
    const tag = `csvexcel${Date.now()}`;
    await db.appLog.create({ data: { level: "warn", category: tag, action: "prueba.csv", message: "uno; dos, «tres»\ncuatro", userId: admin.id, userName: "=Ana" } });
    const download = async () => {
      resetRateLimit(`logs-csv:${admin.id}`);
      const res = await logsCsv(new Request(`http://localhost/api/admin/logs?category=${tag}`));
      assert.equal(res.status, 200);
      return new TextDecoder("utf-8", { ignoreBOM: true }).decode(await res.arrayBuffer());
    };
    const es = await download();
    assert.equal(es.charCodeAt(0), 0xfeff);
    const [head, ...rest] = es.slice(1).split("\r\n");
    assert.equal(head, ["Fecha", "Nivel", "Categoría", "Acción", "Usuario", "Id. de usuario", "Id. de proyecto", "Mensaje", "Duración (ms)", "Ruta", "IP", "Detalles"].map((h) => `"${h}"`).join(";"));
    const row = rest.join("\r\n");
    assert.match(row, /;"warn";/);
    assert.match(row, /;"'=Ana";/);
    assert.match(row, /;"uno; dos, «tres»\ncuatro";/);

    await db.user.update({ where: { id: admin.id }, data: { locale: "EN" } });
    const en = await download();
    assert.equal(en.charCodeAt(0), 0xfeff);
    assert.match(en.slice(1), /^"Date","Level","Category","Action","User","User ID","Project ID","Message","Duration \(ms\)","Path","IP","Details"\r\n/);
    assert.match(en, /,"warn",/);
  });

  test("desde el formulario, pasarse del tope vuelve a la página de Logs con el aviso y los mismos filtros", async () => {
    const admin = await makeUser({ role: "ADMIN" });
    await loginAs(admin);
    resetRateLimit(`logs-csv:${admin.id}`);
    try {
      const nav = { headers: { "sec-fetch-mode": "navigate", accept: "text/html" } };
      const url = "http://localhost/api/admin/logs?level=warn&range=7d&q=algo&desde=2026-01-01&hasta=2026-01-02";
      for (let i = 0; i < 5; i++) {
        const res = await logsCsv(new Request(`http://localhost/api/admin/logs?category=vacia${Date.now()}`));
        assert.equal(res.status, 200);
        await res.text();
      }
      const over = await logsCsv(new Request(url, nav));
      assert.equal(over.status, 303);
      const to = new URL(over.headers.get("location")!, "http://localhost");
      assert.equal(to.pathname, "/admin/logs");
      assert.deepEqual(Object.fromEntries(to.searchParams), { range: "7d", level: "warn", q: "algo", csv: "rate", desde: "2026-01-01", hasta: "2026-01-02" });
      // Fechas mal: también vuelve (con su motivo), sin gastar descargas.
      resetRateLimit(`logs-csv:${admin.id}`);
      const bad = await logsCsv(new Request("http://localhost/api/admin/logs?desde=2026-01-05&hasta=2026-01-02", nav));
      assert.equal(bad.status, 303);
      assert.equal(new URL(bad.headers.get("location")!, "http://localhost").searchParams.get("csv"), "order");
      // Sin ser una navegación (una llamada a la API), el texto de siempre.
      const api = await logsCsv(new Request("http://localhost/api/admin/logs?desde=2026-01-05&hasta=2026-01-02"));
      assert.equal(api.status, 400);
      assert.match(await api.text(), /no puede ser posterior/);
    } finally {
      resetRateLimit(`logs-csv:${admin.id}`);
    }
  });
});

describe("registro de una acción que falla antes de saber su proyecto", () => {
  test("validación en un proyecto privado: solo los nombres de los campos y el motivo, sin los valores", async () => {
    const owner = await makeUser();
    const f = await makeProject({ visibility: "PRIVATE", owner });
    const task = await makeTask(f);
    await loginAs(owner);
    expectFail(await updateTask(task.id, { description: "SECRETO-PRIVADO en la descripción", color: "no-es-un-color" as "#64748b" }));
    await flushLogs();
    const row = await db.appLog.findFirstOrThrow({ where: { action: "tasks.updateTask", userId: owner.id }, orderBy: { createdAt: "desc" } });
    assert.equal(row.level, "warn");
    // Sin proyecto anotado, cualquier administrador vería el registro completo: no debe llevar el texto.
    assert.equal(row.privateProjectId, null);
    assert.equal(JSON.stringify(row).includes("SECRETO-PRIVADO"), false);
    const details = row.details as { args: unknown[]; issues: { path: string; message: string }[] };
    assert.deepEqual(details.args, ["texto", { description: "texto", color: "texto" }, null]);
    assert.ok(details.issues.some((i) => i.path === "color"), JSON.stringify(details.issues));
  });
});

describe("mensajes de las acciones de Mi perfil en Logs", () => {
  // Antes salían como «OK»: ahora dicen qué cambió, en el idioma de quien lee los Logs.
  test("idioma, tema de color y tema: frase con el valor elegido, traducida al leerla", async () => {
    const u = await makeUser();
    await loginAs(u);
    assert.equal((await updateLocale("EN")).ok, true);
    assert.equal((await updateAccent("FOREST")).ok, true);
    assert.equal((await updateTheme("DARK")).ok, true);
    await flushLogs();
    const row = async (action: string) => db.appLog.findFirstOrThrow({ where: { action, userId: u.id }, select: { message: true, details: true } });
    const en = makeT("en");
    const locale = await row("profile.updateLocale");
    assert.equal(locale.message, "Cambió el idioma a English");
    assert.equal(logMessageText(locale, en), "Changed the language to English");
    const accent = await row("profile.updateAccent");
    assert.equal(accent.message, "Cambió el tema de color a «Verde bosque»");
    assert.equal(logMessageText(accent, en), "Changed the color theme to “Forest green”");
    assert.equal(logMessageText(await row("profile.updateTheme"), en), "Changed the theme to “Dark”");
  });
});
