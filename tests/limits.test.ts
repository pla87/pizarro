// Tope opcional de usuarios activos (MAX_USERS, lib/limits.ts): sin la variable no hay tope; con ella, validado como
// DATABASE_POOL_SIZE y señalado en el diagnóstico.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { maxUsersConfig } from "../src/lib/limits";
import { envPresence } from "../src/lib/doctor-core";

test("sin variable (o vacía): sin tope y sin aviso", () => {
  assert.deepEqual(maxUsersConfig({}), { max: null, source: "default", warning: null });
  assert.deepEqual(maxUsersConfig({ MAX_USERS: "  " }), { max: null, source: "default", warning: null });
  assert.deepEqual(maxUsersConfig({ MAX_USERS: "" }), { max: null, source: "default", warning: null });
});

test("un entero válido se usa", () => {
  assert.deepEqual(maxUsersConfig({ MAX_USERS: " 50 " }), { max: 50, source: "env", warning: null });
  assert.equal(maxUsersConfig({ MAX_USERS: "100000" }).max, 100000);
  assert.equal(maxUsersConfig({ MAX_USERS: "1" }).max, 1);
  assert.equal(maxUsersConfig({ MAX_USERS: "1000000" }).max, 1_000_000);
});

test("un valor que no es un entero entre 1 y un millón no rompe: no se aplica (sin tope) y avisa (antes NaN = sin tope, 0 = nadie)", () => {
  for (const raw of ["diez", "0", "-5", "2.5", "1e3", "10 usuarios", "1000001", "99999999999999999999"]) {
    const c = maxUsersConfig({ MAX_USERS: raw });
    assert.equal(c.max, null, raw);
    assert.equal(c.source, "invalid", raw);
    assert.match(c.warning ?? "", /MAX_USERS no es un número entero .* no se aplica ningún tope/, raw);
  }
});

test("el diagnóstico marca MAX_USERS no válida (sin dar su valor)", () => {
  assert.equal(envPresence({ MAX_USERS: "diez" }).MAX_USERS, "invalid");
  assert.equal(envPresence({ MAX_USERS: "25" }).MAX_USERS, "set");
  assert.equal(envPresence({}).MAX_USERS, "unset");
});

test("Administración → Usuarios: «N activos · M invitaciones pendientes», «de N» solo con tope, y el botón desactivado en el tope", () => {
  const src = readFileSync(new URL("../src/app/(app)/admin/users/UsersAdmin.tsx", import.meta.url), "utf8");
  assert.match(src, /maxUsers !== null \? \[t\("\{n\} de \{max\} como máximo", \{ n: activeCount, max: maxUsers \}\)\]/);
  assert.match(src, /t\("\{n\} activos", \{ n: joinedCount \}\)/);
  // Las invitaciones sin aceptar no cuentan como activas en el resumen (sí en el tope) y solo salen si hay alguna.
  assert.match(src, /const joinedCount = activeCount - pendingCount;/);
  assert.match(src, /\.\.\.\(pendingCount \? \[/);
  assert.match(src, /const atMax = maxUsers !== null && activeCount >= maxUsers;/);
  assert.match(src, /disabled=\{atMax\} aria-describedby=\{atMax \? "new-user-why" : undefined\}/);
  // La documentación de instalación dice que es opcional.
  const env = readFileSync(new URL("../.env.example", import.meta.url), "utf8");
  assert.match(env, /^# MAX_USERS=\S*\s+# Opcional/m);
});
