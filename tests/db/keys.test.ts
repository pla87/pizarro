// Rotación de claves contra la BD: re-cifrado perezoso al leer, comando de rotación y tokens con la clave anterior.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { db, makeUser } from "./helpers";
import { decryptSecret, encryptSecret } from "../../src/lib/crypto";
import { rotateEncryptedSecrets, type RotationDb } from "../../src/lib/key-rotation";
import { hashAuthToken, newToken } from "../../src/lib/auth-token-core";
import { findUsableToken } from "../../src/lib/auth-token";
import { checkCode, verifyTotpFor } from "../../src/lib/two-factor";
import { generateRecoveryCodes, generateTotpSecret, hashRecoveryCode, totpAt } from "../../src/lib/two-factor-core";

const OLD = "o".repeat(48);
const NEW = "n".repeat(48);

/** Ejecuta fn con estas variables y deja process.env como estaba. */
async function withEnv<T>(vars: Record<string, string | undefined>, fn: () => Promise<T>): Promise<T> {
  const saved = Object.fromEntries(Object.keys(vars).map((k) => [k, process.env[k]]));
  Object.assign(process.env, vars);
  for (const [k, v] of Object.entries(vars)) if (v === undefined) delete process.env[k];
  try {
    return await fn();
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

describe("ENCRYPTION_KEY con la clave anterior", () => {
  test("al verificar un código TOTP, el secreto cifrado con la anterior se re-cifra con la actual", async () => {
    const secret = generateTotpSecret();
    const enc = await withEnv({ ENCRYPTION_KEY: OLD }, async () => encryptSecret(secret));
    const user = await makeUser();
    await db.user.update({ where: { id: user.id }, data: { twoFactorMethod: "TOTP", totpSecretEnc: enc } });

    await withEnv({ ENCRYPTION_KEY: NEW, ENCRYPTION_KEY_PREVIOUS: OLD }, async () => {
      assert.equal(await verifyTotpFor(enc, totpAt(secret, Date.now()), user.id, null), true);
    });
    const after = (await db.user.findUniqueOrThrow({ where: { id: user.id } })).totpSecretEnc!;
    assert.notEqual(after, enc);
    // Ya se abre sin la clave anterior.
    await withEnv({ ENCRYPTION_KEY: NEW, ENCRYPTION_KEY_PREVIOUS: undefined }, async () => assert.equal(decryptSecret(after), secret));
  });

  test("el comando re-cifra los tokens de Google y los secretos TOTP", async () => {
    const user = await makeUser();
    const [totp, refresh, access] = await withEnv({ ENCRYPTION_KEY: OLD }, async () => [encryptSecret("T"), encryptSecret("R"), encryptSecret("A")]);
    await db.user.update({ where: { id: user.id }, data: { twoFactorMethod: "TOTP", totpSecretEnc: totp } });
    await db.googleAccount.create({ data: { userId: user.id, email: "g@example.com", refreshTokenEnc: refresh!, accessTokenEnc: access, scope: "drive.file" } });

    const counts = await withEnv({ ENCRYPTION_KEY: NEW, ENCRYPTION_KEY_PREVIOUS: OLD }, () => rotateEncryptedSecrets(db as unknown as RotationDb));
    // Otras pruebas comparten la BD con secretos de otras claves (ilegibles aquí): solo se mira lo de esta persona.
    assert.ok(counts.reduce((a, c) => a + c.rotated, 0) >= 3);

    await withEnv({ ENCRYPTION_KEY: NEW, ENCRYPTION_KEY_PREVIOUS: undefined }, async () => {
      const u = await db.user.findUniqueOrThrow({ where: { id: user.id } });
      const g = await db.googleAccount.findUniqueOrThrow({ where: { userId: user.id } });
      assert.equal(decryptSecret(u.totpSecretEnc!), "T");
      assert.equal(decryptSecret(g.refreshTokenEnc), "R");
      assert.equal(decryptSecret(g.accessTokenEnc!), "A");
    });
  });
});

describe("TOKEN_SECRET con la clave anterior", () => {
  test("un enlace emitido antes de rotar sigue sirviendo con TOKEN_SECRET_PREVIOUS, y deja de servir sin ella", async () => {
    const user = await makeUser();
    const token = newToken();
    const hash = await withEnv({ TOKEN_SECRET: OLD }, async () => hashAuthToken(token));
    await db.authToken.create({ data: { userId: user.id, purpose: "PASSWORD_RESET", tokenHash: hash, expiresAt: new Date(Date.now() + 60_000) } });

    await withEnv({ TOKEN_SECRET: NEW, TOKEN_SECRET_PREVIOUS: OLD }, async () => {
      assert.equal((await findUsableToken(token, ["PASSWORD_RESET"]))?.userId, user.id);
    });
    await withEnv({ TOKEN_SECRET: NEW, TOKEN_SECRET_PREVIOUS: undefined }, async () => {
      assert.equal(await findUsableToken(token, ["PASSWORD_RESET"]), null);
    });
  });

  test("los códigos de recuperación guardados con la clave anterior se aceptan durante la rotación", async () => {
    const user = await makeUser();
    const [code] = generateRecoveryCodes(1) as [string];
    const codeHash = await withEnv({ TOKEN_SECRET: OLD }, async () => hashRecoveryCode(code));
    await db.recoveryCode.create({ data: { userId: user.id, codeHash } });
    await db.user.update({ where: { id: user.id }, data: { twoFactorMethod: "TOTP" } });
    const row = await db.loginChallenge.create({ data: { userId: user.id, kind: "LOGIN", tokenHash: hashAuthToken(newToken()), expiresAt: new Date(Date.now() + 60_000) } });
    const ch = await db.loginChallenge.findUniqueOrThrow({
      where: { id: row.id },
      include: { user: { select: { id: true, name: true, email: true, locale: true, role: true, active: true, mustChangePassword: true, twoFactorMethod: true, totpSecretEnc: true, totpLastStep: true } } },
    });
    const result = await withEnv({ TOKEN_SECRET: NEW, TOKEN_SECRET_PREVIOUS: OLD }, () => checkCode(ch, code));
    assert.equal(result, "ok");
    assert.ok((await db.recoveryCode.findFirstOrThrow({ where: { userId: user.id } })).usedAt);
  });
});
