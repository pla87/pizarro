// Zona horaria de las conexiones: con la base (o el servidor) en otra zona, los NOW() de las consultas propias y de los
// disparadores se guardaban en esa hora en columnas timestamp(3) sin zona, que Prisma lee como UTC (una o dos horas de
// desfase en «archivar varias», el despliegue con archivo o la entrada en columna). Cada conexión fija ahora UTC.
import assert from "node:assert/strict";
import { after, describe, test } from "node:test";
import pg from "pg";

const url = process.env.DATABASE_URL!;
const dbName = new URL(url).pathname.slice(1);
assert.match(dbName, /^pizarro_test_[0-9a-f]+$/);

/** Conexión aparte (sin la configuración de la app) para cambiar la zona de la base de pruebas. */
async function admin(sql: string) {
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  try {
    return await c.query(sql);
  } finally {
    await c.end();
  }
}

// Antes de que la app abra ninguna conexión: las nuevas heredan la zona de la base.
await admin(`ALTER DATABASE "${dbName}" SET timezone = 'Europe/Madrid'`);
after(async () => {
  await admin(`ALTER DATABASE "${dbName}" RESET timezone`);
});

const { db, expectOk, loginAs, makeProject, makeTask, makeUser } = await import("./helpers");
const { archiveTasks, moveTask } = await import("../../src/actions/tasks");
const { connectPgClient, utcSessionConfig } = await import("../../src/lib/pg-connect");

/** ¿`d` está a menos de un minuto de ahora? (el desfase que se vigila es de una o dos horas). */
const nearNow = (d: Date | null | undefined, label: string) => {
  assert.ok(d, `${label}: sin fecha`);
  assert.ok(Math.abs(d.getTime() - Date.now()) < 60_000, `${label}: ${d.toISOString()} frente a ${new Date().toISOString()}`);
};

describe("zona horaria de las conexiones con la base en Europe/Madrid", () => {
  test("una conexión sin la configuración de la app sí ve la otra zona (la prueba tiene sentido)", async () => {
    const r = await admin("SELECT current_setting('TimeZone') AS tz");
    assert.equal(r.rows[0].tz, "Europe/Madrid");
  });

  test("el pool de Prisma: la sesión va en UTC y NOW() coincide con la hora UTC", async () => {
    const [row] = await db.$queryRaw<{ tz: string; now: Date }[]>`SELECT current_setting('TimeZone') AS tz, NOW()::timestamp(3) AS now`;
    assert.equal(row!.tz, "UTC");
    nearNow(row!.now, "NOW()");
  });

  test("archivar varias (NOW() en la consulta) y mover (disparador task_column_entered) guardan la hora UTC", async () => {
    const user = await makeUser();
    const f = await makeProject({ members: [user] });
    await loginAs(user);
    const a = await makeTask(f, { title: "A" });
    const b = await makeTask(f, { title: "B", position: 2000 });
    expectOk(await archiveTasks([a.id, b.id]));
    for (const t of await db.task.findMany({ where: { id: { in: [a.id, b.id] } } })) nearNow(t.archivedAt, "archivedAt");
    const c = await makeTask(f, { title: "C" });
    expectOk(await moveTask(c.id, f.columns.doing, null, null));
    nearNow((await db.task.findUniqueOrThrow({ where: { id: c.id } })).columnEnteredAt, "columnEnteredAt");
  });

  test("las conexiones propias (copias, tareas de fondo) también, y se respeta el options de la URL", async () => {
    const client = await connectPgClient(url, { label: "prueba" });
    try {
      const r = await client.query("SELECT current_setting('TimeZone') AS tz, current_setting('application_name') AS app");
      assert.equal(r.rows[0].tz, "UTC");
    } finally {
      await client.end();
    }
    const withOptions = new URL(url);
    withOptions.searchParams.set("options", "-c application_name=pz-prueba");
    const cfg = utcSessionConfig(withOptions.toString());
    assert.equal(cfg.options, undefined);
    const c2 = new pg.Client(cfg);
    await c2.connect();
    try {
      const r = await c2.query("SELECT current_setting('TimeZone') AS tz, current_setting('application_name') AS app");
      assert.deepEqual(r.rows[0], { tz: "UTC", app: "pz-prueba" });
    } finally {
      await c2.end();
    }
  });
});
