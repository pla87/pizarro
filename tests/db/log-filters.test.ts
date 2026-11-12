// Filtros de Administración → Logs (página y descarga CSV) contra PostgreSQL real: un NUL en la URL no llega a la base.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { db, loginAs, makeUser } from "./helpers";
import { logWhere, parseLogFilters } from "../../src/lib/log-query";
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
