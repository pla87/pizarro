import assert from "node:assert/strict";
import { test } from "node:test";
import { quotaError } from "../src/lib/quota-message";
import { QUOTA_MAX_MB, quotaMbValid } from "../src/lib/quota";

// t de prueba: sustituye {var} como el real.
const t = (key: string, vars?: Record<string, string | number>) => key.replace(/\{(\w+)\}/g, (_, k) => String(vars?.[k] ?? `{${k}}`));
const q = (scope: "project" | "total") => ({ scope, usedMb: 12.5, limitMb: 10 });

test("cuota total: administrador con enlace y sin marcadores sin sustituir", () => {
  const e = quotaError(t, q("total"), { projectId: "p1", isAdmin: true });
  assert.equal(e.code, "quota_total");
  assert.equal(e.status, 413);
  assert.match(e.message, /12\.5 de 10 MB/);
  assert.match(e.message, /\/admin\/settings/);
  assert.doesNotMatch(e.message, /\{/);
});

test("cuota total: no administrador muestra uso y límite", () => {
  const e = quotaError(t, q("total"), { projectId: "p1", isAdmin: false });
  assert.equal(e.code, "quota_total");
  assert.match(e.message, /12\.5 de 10 MB/);
  assert.doesNotMatch(e.message, /\{/);
});

test("cuota de proyecto: sin proyecto (importación)", () => {
  const e = quotaError(t, q("project"), { projectId: null, isAdmin: false });
  assert.equal(e.code, "quota_project");
  assert.match(e.message, /12\.5 de 10 MB/);
  assert.doesNotMatch(e.message, /\{/);
});

test("cuota de proyecto: administrador con enlace a los ajustes, otros sin enlace", () => {
  const a = quotaError(t, q("project"), { projectId: "p1", isAdmin: true });
  assert.match(a.message, /\/p\/p1\/settings\?tab=adjuntos/);
  const u = quotaError(t, q("project"), { projectId: "p1", isAdmin: false });
  assert.doesNotMatch(u.message, /\/p\/p1/);
  assert.doesNotMatch(u.message, /\{/);
});

test("campo de cuota: el formulario acepta lo mismo que el servidor (entero de 1 a QUOTA_MAX_MB)", () => {
  for (const ok of ["1", "10240", String(QUOTA_MAX_MB), " 25 "]) assert.equal(quotaMbValid(ok), true, ok);
  for (const bad of ["", "  ", "0", "-5", "1.5", "abc", "99999999999999", String(QUOTA_MAX_MB + 1), "1e20"]) assert.equal(quotaMbValid(bad), false, bad);
});
