// Migración «mensajeria»: los números de WhatsApp de User pasan a UserChannel. Quien tenía los avisos activados queda
// confirmado (con consentimiento, solo menciones); quien tenía el número guardado con WhatsApp desactivado lo conserva
// sin consentimiento ni verificación (no recibe nada hasta confirmarlo con el código).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { db } from "./helpers";

describe("migración mensajeria", () => {
  test("conserva los números de WhatsApp: activos como canal confirmado, desactivados como canal sin consentimiento", async () => {
    const sql = readFileSync("prisma/migrations/20261120100000_mensajeria/migration.sql", "utf8");
    // Esquema de pruebas aparte: tablas mínimas con la forma previa a la migración.
    await db.$executeRawUnsafe(`DROP SCHEMA IF EXISTS mig_mensajeria CASCADE`);
    await db.$executeRawUnsafe(`CREATE SCHEMA mig_mensajeria`);
    try {
      await db.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(`SET LOCAL search_path TO mig_mensajeria`);
        await tx.$executeRawUnsafe(`CREATE TABLE "User" ("id" TEXT PRIMARY KEY, "notifyWhatsapp" BOOLEAN NOT NULL DEFAULT false, "whatsappPhone" TEXT)`);
        await tx.$executeRawUnsafe(`CREATE TABLE "Notification" ("id" TEXT PRIMARY KEY)`);
        await tx.$executeRawUnsafe(`INSERT INTO "User" VALUES ('on', true, '+34600111222'), ('off', false, '+34600333444'), ('empty', false, ''), ('none', true, NULL)`);
        for (const stmt of sql.split(";").map((s) => s.replace(/^\s*--.*$/gm, "").trim()).filter(Boolean)) await tx.$executeRawUnsafe(stmt);
        const rows = await tx.$queryRawUnsafe<{ userId: string; address: string; verified: boolean; consent: boolean; notifyMention: boolean; notifyAssigned: boolean; verifyAttempts: number }[]>(
          `SELECT "userId", "address", "verifiedAt" IS NOT NULL AS verified, "consentAt" IS NOT NULL AS consent, "notifyMention", "notifyAssigned", "verifyAttempts" FROM "UserChannel" WHERE "channel" = 'WHATSAPP' ORDER BY "userId"`,
        );
        assert.deepEqual(rows, [
          { userId: "off", address: "+34600333444", verified: false, consent: false, notifyMention: true, notifyAssigned: false, verifyAttempts: 0 },
          { userId: "on", address: "+34600111222", verified: true, consent: true, notifyMention: true, notifyAssigned: false, verifyAttempts: 0 },
        ]);
        const cols = await tx.$queryRawUnsafe<{ column_name: string }[]>(`SELECT column_name FROM information_schema.columns WHERE table_schema = 'mig_mensajeria' AND table_name = 'User'`);
        assert.deepEqual(cols.map((c) => c.column_name), ["id"]);
      });
    } finally {
      await db.$executeRawUnsafe(`DROP SCHEMA IF EXISTS mig_mensajeria CASCADE`);
    }
  });
});
