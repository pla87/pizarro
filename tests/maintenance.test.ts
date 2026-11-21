import assert from "node:assert/strict";
import { test } from "node:test";
import { nonImageCopyCutoff } from "../src/lib/maintenance";

const now = new Date("2026-06-30T12:00:00Z");

test("copias no imagen: 7 días", () => {
  assert.equal(nonImageCopyCutoff(now).toISOString(), "2026-06-23T12:00:00.000Z");
});

test("correo programado: a la hora en punto (+1 min) de la zona de la app, no a la hora del arranque", async () => {
  const { msUntilMailPass } = await import("../src/lib/maintenance");
  const min = 60_000;
  // 08:37:20 en Madrid (verano, UTC+2): la siguiente pasada a las 09:01:00.
  assert.equal(msUntilMailPass(new Date("2026-06-30T06:37:20Z"), "Europe/Madrid"), 23 * min + 40_000);
  // En el primer minuto tras la hora en punto toca ya (08:00:30 → 08:01:00), no dentro de una hora.
  assert.equal(msUntilMailPass(new Date("2026-06-30T06:00:30Z"), "Europe/Madrid"), 30_000);
  // Justo a las 08:01:00 → la de las 09:01.
  assert.equal(msUntilMailPass(new Date("2026-06-30T06:01:00Z"), "Europe/Madrid"), 60 * min);
  // Zona con media hora (UTC+5:30): 06:37:20 UTC son las 12:07:20 locales → 13:01 locales.
  assert.equal(msUntilMailPass(new Date("2026-06-30T06:37:20Z"), "Asia/Kolkata"), 53 * min + 40_000);
  // Zona no válida: la de UTC.
  assert.equal(msUntilMailPass(new Date("2026-06-30T06:37:20Z"), "No/Existe"), 23 * min + 40_000);
});

test("limpiezas con retención de días: una vez al día; deshacer sigue en cada pasada", async () => {
  const { MAINTENANCE_JOBS } = await import("../src/lib/maintenance");
  const every = (name: string) => {
    const job = MAINTENANCE_JOBS.find((j) => j.name === name);
    assert.ok(job, name);
    return "everyMs" in job ? job.everyMs : undefined;
  };
  for (const name of ["nonImageCopies", "notifications", "authData", "taskHistory", "orphanFiles", "documentsTrashPurge"]) {
    assert.equal(every(name), 23 * 60 * 60 * 1000, name);
  }
  assert.equal(every("undo"), undefined);
});
