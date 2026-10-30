import assert from "node:assert/strict";
import { describe, test } from "node:test";

process.env.SESSION_SECRET ??= "x".repeat(48);
process.env.DATABASE_URL ??= "postgresql://none:none@localhost:5432/none";
const { REPORT_RETRY_MS, clearReportFailure, noteReportFailure, reportRetryAllowed } = await import("../src/lib/periodic-mail");

describe("reintento del informe semanal tras un fallo", () => {
  test("no se reintenta hasta pasada una hora, solo para ese proyecto", () => {
    const t0 = new Date("2026-11-02T08:00:00Z");
    assert.equal(reportRetryAllowed("p1", t0), true);
    noteReportFailure("p1", t0);
    assert.equal(reportRetryAllowed("p1", new Date(t0.getTime() + 60_000)), false);
    assert.equal(reportRetryAllowed("p1", new Date(t0.getTime() + REPORT_RETRY_MS - 1)), false);
    assert.equal(reportRetryAllowed("p1", new Date(t0.getTime() + REPORT_RETRY_MS)), true);
    assert.equal(reportRetryAllowed("p2", new Date(t0.getTime() + 60_000)), true);
    clearReportFailure("p1");
    assert.equal(reportRetryAllowed("p1", new Date(t0.getTime() + 60_000)), true);
  });
});
