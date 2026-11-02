import assert from "node:assert/strict";
import { test } from "node:test";
import { quotaError } from "../src/lib/quota-message";

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
