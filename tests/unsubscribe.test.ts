// Baja en un clic de los emails de avisos, resumen e informe (RFC 8058): token firmado de un solo propósito y cabeceras.
import assert from "node:assert/strict";
import { test } from "node:test";

process.env.SESSION_SECRET ??= "x".repeat(48);

const core = await import("../src/lib/unsubscribe-core");

test("baja: el token solo vale para su tipo, su id y su email de destino", () => {
  const token = core.unsubscribeToken("comment", "user123", "Ana@Example.com");
  const parsed = core.parseUnsubscribeToken(token)!;
  assert.deepEqual([parsed.kind, parsed.id], ["comment", "user123"]);
  assert.equal(core.unsubscribeSignatureOk(parsed, "ana@example.com"), true, "sin distinguir mayúsculas en el email");
  assert.equal(core.unsubscribeSignatureOk(parsed, "otra@example.com"), false, "otro destino (email cambiado): no vale");
  // Cambiar la letra del tipo (para apagar otra casilla) o el id invalida la firma.
  for (const forged of [`m${token.slice(1)}`, token.replace("user123", "user124")]) {
    const p = core.parseUnsubscribeToken(forged)!;
    assert.equal(core.unsubscribeSignatureOk(p, "ana@example.com"), false, forged);
  }
  for (const bad of ["", "x", "zuser.0123456789abcdef0123456789abcdef", `${token}x`, token.slice(0, -1), `c../x.${"0".repeat(32)}`]) {
    assert.equal(core.parseUnsubscribeToken(bad), null, bad);
  }
  assert.ok(token.length < 80, "cabe sin problema en una cabecera y en un enlace");
});

test("baja: tras rotar TOKEN_SECRET, los enlaces de los emails ya enviados siguen valiendo", () => {
  const prev = { TOKEN_SECRET: process.env.TOKEN_SECRET, TOKEN_SECRET_PREVIOUS: process.env.TOKEN_SECRET_PREVIOUS };
  try {
    process.env.TOKEN_SECRET = "a".repeat(40);
    delete process.env.TOKEN_SECRET_PREVIOUS;
    const old = core.parseUnsubscribeToken(core.unsubscribeToken("digest", "u1", "ana@example.com"))!;
    process.env.TOKEN_SECRET = "b".repeat(40);
    assert.equal(core.unsubscribeSignatureOk(old, "ana@example.com"), false);
    process.env.TOKEN_SECRET_PREVIOUS = "a".repeat(40);
    assert.equal(core.unsubscribeSignatureOk(old, "ana@example.com"), true);
  } finally {
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
});

test("baja: cabeceras List-Unsubscribe solo con https, y cada aviso apaga la casilla que lo decide", () => {
  assert.deepEqual(core.unsubscribeHeaders("https://pizarro.example.com/api/unsubscribe/t"), {
    "List-Unsubscribe": "<https://pizarro.example.com/api/unsubscribe/t>",
    "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
  });
  assert.deepEqual(core.unsubscribeHeaders("http://localhost:3000/api/unsubscribe/t"), {});
  const kinds = (["MENTION", "PROJECT_TO_TEAM", "REPORT_UNSUBSCRIBED", "ASSIGNED", "DUE_CHANGED", "WAITING", "COMMENT", "REPLY"] as const).map(core.noticeEmailKind);
  assert.deepEqual(kinds, ["mention", "admin", "admin", "assigned", "due", "due", "comment", "comment"]);
  assert.equal(core.noticeEmailKind("SHARE_REVOKED"), "admin");
  assert.equal(core.EMAIL_PREF_FIELD.admin, "notifyAdminEmail");
  assert.equal(core.EMAIL_PREF_FIELD.note, "notifyEmail");
  assert.equal(core.EMAIL_PREF_FIELD.due, "notifyDueEmail");
});

test("baja de las menciones en notas: su propio tipo de enlace («n»), que no vale para otro", () => {
  const token = core.unsubscribeToken("note", "user1", "ana@example.com");
  assert.ok(token.startsWith("nuser1."));
  const parsed = core.parseUnsubscribeToken(token);
  assert.deepEqual(parsed && { kind: parsed.kind, id: parsed.id }, { kind: "note", id: "user1" });
  assert.ok(core.unsubscribeSignatureOk(parsed!, "ana@example.com"));
  // Con la letra de las menciones, la firma ya no vale.
  assert.ok(!core.unsubscribeSignatureOk({ ...parsed!, kind: "mention" }, "ana@example.com"));
});
