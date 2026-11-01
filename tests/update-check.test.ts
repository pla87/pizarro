import assert from "node:assert/strict";
import { test } from "node:test";
import {
  compareSemver, isNewerVersion, parseLatestRelease, parseSemver, parseUpdateCache, pendingUpdate, refreshUpdateCache,
  UPDATE_CHECK_INTERVAL_MS, UPDATE_CHECK_RETRY_MS, updateCheckDue, type UpdateCache,
} from "../src/lib/update-check-core";

const now = Date.parse("2026-11-02T12:00:00Z");

test("semver: analiza X.Y.Z con o sin «v» y rechaza el resto", () => {
  assert.deepEqual(parseSemver("v1.38.0"), [1, 38, 0]);
  assert.deepEqual(parseSemver("1.2.3"), [1, 2, 3]);
  for (const bad of ["1.2", "v1.2.3-rc.1", "latest", "", "1.2.3.4", "a.b.c", null, 5]) assert.equal(parseSemver(bad), null);
});

test("semver: compara numéricamente (1.10.0 > 1.9.0), no como texto", () => {
  assert.ok(isNewerVersion("1.10.0", "1.9.0"));
  assert.ok(isNewerVersion("2.0.0", "1.99.99"));
  assert.ok(isNewerVersion("1.37.1", "1.37.0"));
  assert.ok(!isNewerVersion("1.37.0", "1.37.0"));
  assert.ok(!isNewerVersion("1.36.9", "1.37.0"));
  assert.equal(compareSemver("1.0.0", "x"), null);
  assert.ok(!isNewerVersion("basura", "1.0.0"));
});

test("release: usa tag_name y html_url de GitHub; ignora borradores, preversiones y enlaces ajenos", () => {
  const ok = parseLatestRelease({ tag_name: "v1.38.0", html_url: "https://github.com/pla87/pizarro/releases/tag/v1.38.0" });
  assert.deepEqual(ok, { version: "1.38.0", url: "https://github.com/pla87/pizarro/releases/tag/v1.38.0" });
  assert.equal(parseLatestRelease({ tag_name: "v1.38.0", prerelease: true }), null);
  assert.equal(parseLatestRelease({ tag_name: "v1.38.0", draft: true }), null);
  assert.equal(parseLatestRelease({ tag_name: "nightly" }), null);
  assert.equal(parseLatestRelease({ message: "API rate limit exceeded" }), null);
  assert.equal(parseLatestRelease(null), null);
  assert.equal(parseLatestRelease({ tag_name: "v1.38.0", html_url: "https://evil.example.com/x" })?.url, "https://github.com/pla87/pizarro/releases/tag/v1.38.0");
});

test("caché: consulta la primera vez, no antes de 12 h y sí después; tras un fallo reintenta antes", () => {
  const c: UpdateCache = { checkedAt: now, latest: "1.38.0", url: null };
  assert.ok(updateCheckDue(null, now));
  assert.ok(!updateCheckDue(c, now + UPDATE_CHECK_INTERVAL_MS - 1));
  assert.ok(updateCheckDue(c, now + UPDATE_CHECK_INTERVAL_MS));
  const failed = { ...c, failed: true };
  assert.ok(!updateCheckDue(failed, now + UPDATE_CHECK_RETRY_MS - 1));
  assert.ok(updateCheckDue(failed, now + UPDATE_CHECK_RETRY_MS));
  assert.ok(updateCheckDue({ ...c, checkedAt: now + 5000 }, now), "una fecha futura (reloj movido) fuerza consultar");
});

test("caché: dentro del plazo no llama a la red", async () => {
  let calls = 0;
  const c: UpdateCache = { checkedAt: now, latest: "1.38.0", url: "u" };
  const r = await refreshUpdateCache(c, now + 1000, async () => { calls++; return null; });
  assert.equal(calls, 0);
  assert.equal(r.changed, false);
  assert.equal(r.cache, c);
});

test("caché: pasado el plazo guarda la versión encontrada", async () => {
  const c: UpdateCache = { checkedAt: now, latest: "1.38.0", url: "u" };
  const later = now + UPDATE_CHECK_INTERVAL_MS;
  const r = await refreshUpdateCache(c, later, async () => ({ version: "1.39.0", url: "https://github.com/pla87/pizarro/releases/tag/v1.39.0" }));
  assert.deepEqual(r.cache, { checkedAt: later, latest: "1.39.0", url: "https://github.com/pla87/pizarro/releases/tag/v1.39.0" });
  assert.ok(r.changed);
});

test("caché: sin red (lanza) o sin respuesta válida conserva la última versión y marca el fallo, sin lanzar", async () => {
  const c: UpdateCache = { checkedAt: now - UPDATE_CHECK_INTERVAL_MS, latest: "1.38.0", url: "u" };
  const offline = await refreshUpdateCache(c, now, async () => { throw new Error("ENOTFOUND"); });
  assert.deepEqual(offline.cache, { checkedAt: now, latest: "1.38.0", url: "u", failed: true });
  const limited = await refreshUpdateCache(c, now, async () => null);
  assert.deepEqual(limited.cache, { checkedAt: now, latest: "1.38.0", url: "u", failed: true });
  const first = await refreshUpdateCache(null, now, async () => { throw new Error("offline"); });
  assert.deepEqual(first.cache, { checkedAt: now, latest: null, url: null, failed: true });
  assert.equal(pendingUpdate(first.cache, "1.37.0", null), null);
});

test("caché guardada: JSON válido se lee; basura o versión rara se descarta", () => {
  assert.deepEqual(parseUpdateCache(JSON.stringify({ checkedAt: 5, latest: "1.2.3", url: "u" })), { checkedAt: 5, latest: "1.2.3", url: "u", failed: false });
  assert.equal(parseUpdateCache("{no json"), null);
  assert.equal(parseUpdateCache(null), null);
  assert.equal(parseUpdateCache(JSON.stringify({ latest: "1.2.3" })), null);
  assert.equal(parseUpdateCache(JSON.stringify({ checkedAt: 1, latest: "<script>" }))?.latest, null);
});

test("aviso: solo si la conocida es más nueva que la actual y no está descartada (descartar es por versión)", () => {
  const c: UpdateCache = { checkedAt: now, latest: "1.38.0", url: "https://github.com/pla87/pizarro/releases/tag/v1.38.0" };
  assert.deepEqual(pendingUpdate(c, "1.37.0", null), { version: "1.38.0", url: c.url });
  assert.equal(pendingUpdate(c, "1.38.0", null), null);
  assert.equal(pendingUpdate(c, "1.39.0", null), null);
  assert.equal(pendingUpdate(c, "1.37.0", "1.38.0"), null, "descartada");
  assert.equal(pendingUpdate(c, "1.37.0", "1.37.5")?.version, "1.38.0", "descartó una anterior: vuelve a avisar");
  assert.equal(pendingUpdate({ ...c, latest: "1.39.0" }, "1.37.0", "1.38.0")?.version, "1.39.0", "una más nueva vuelve a avisar");
  assert.equal(pendingUpdate(null, "1.37.0", null), null);
  assert.equal(pendingUpdate({ ...c, url: null }, "1.37.0", null)?.url, "https://github.com/pla87/pizarro/releases/tag/v1.38.0");
});
