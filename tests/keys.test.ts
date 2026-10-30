// Separación y rotación de claves (lib/keyring.ts, lib/key-rotation.ts): SESSION_SECRET, TOKEN_SECRET y ENCRYPTION_KEY.
import assert from "node:assert/strict";
import { createCipheriv, createHmac, hkdfSync, randomBytes } from "node:crypto";
import { describe, test } from "node:test";

const SESSION = "s".repeat(48);
const TOKEN = "t".repeat(48);
const ENC = "e".repeat(48);
const ENC2 = "f".repeat(48);
process.env.SESSION_SECRET = SESSION;

const keyring = await import("../src/lib/keyring");
const { rotateEncryptedSecrets, ENCRYPTED_FIELDS } = await import("../src/lib/key-rotation");
const core = await import("../src/lib/auth-token-core");
const twoFactor = await import("../src/lib/two-factor-core");

/** Exactamente el cifrado de antes de separar las claves (v1, clave derivada de SESSION_SECRET): lo que ya hay en las BD. */
function legacyEncrypt(plain: string, secret: string): string {
  const key = Buffer.from(hkdfSync("sha256", secret, "tablon", "tablon-token-encryption-v1", 32));
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), data.toString("base64url")].join(".");
}
/** El HMAC de antes: SESSION_SECRET con etiqueta. */
const legacyHmac = (label: string, value: string, secret = SESSION) => createHmac("sha256", secret).update(`${label}:${value}`).digest("hex");

describe("HMAC de tokens (TOKEN_SECRET)", () => {
  test("sin TOKEN_SECRET: idéntico al de siempre (las instalaciones existentes no notan nada)", () => {
    const env = { SESSION_SECRET: SESSION };
    assert.equal(keyring.labelledHmac("auth-token", "abc", env), legacyHmac("auth-token", "abc"));
    assert.deepEqual(keyring.tokenSecrets(env), [SESSION]);
    // Las funciones de la app usan process.env y también coinciden.
    assert.equal(core.hashAuthToken("abc"), legacyHmac("auth-token", "abc"));
    assert.equal(twoFactor.hashRecoveryCode("ABCD-EFGH"), legacyHmac("recovery", "ABCD-EFGH"));
  });

  test("con TOKEN_SECRET: usa esa clave, no SESSION_SECRET", () => {
    const env = { SESSION_SECRET: SESSION, TOKEN_SECRET: TOKEN };
    assert.equal(keyring.labelledHmac("device", "d1", env), legacyHmac("device", "d1", TOKEN));
    assert.notEqual(keyring.labelledHmac("device", "d1", env), legacyHmac("device", "d1"));
  });

  test("cambiar SESSION_SECRET no cambia los hashes de tokens si TOKEN_SECRET está definida", () => {
    const a = keyring.labelledHmac("recovery", "X", { SESSION_SECRET: SESSION, TOKEN_SECRET: TOKEN });
    const b = keyring.labelledHmac("recovery", "X", { SESSION_SECRET: "z".repeat(40), TOKEN_SECRET: TOKEN });
    assert.equal(a, b);
  });

  test("TOKEN_SECRET_PREVIOUS: los candidatos llevan primero la actual y después la anterior", () => {
    const env = { SESSION_SECRET: SESSION, TOKEN_SECRET: TOKEN, TOKEN_SECRET_PREVIOUS: SESSION };
    assert.deepEqual(keyring.labelledHmacCandidates("auth-token", "tok", env), [legacyHmac("auth-token", "tok", TOKEN), legacyHmac("auth-token", "tok")]);
    // Separar las claves de una instalación existente: lo guardado con SESSION_SECRET se sigue encontrando.
    assert.ok(keyring.labelledHmacCandidates("recovery", "C", env).includes(legacyHmac("recovery", "C")));
  });

  test("TOKEN_SECRET_PREVIOUS igual a la actual no duplica candidatos", () => {
    assert.equal(keyring.labelledHmacCandidates("x", "y", { SESSION_SECRET: SESSION, TOKEN_SECRET: TOKEN, TOKEN_SECRET_PREVIOUS: TOKEN }).length, 1);
  });

  test("una clave opcional demasiado corta es un error (no se usa una clave débil en silencio)", () => {
    assert.throws(() => keyring.tokenSecret({ SESSION_SECRET: SESSION, TOKEN_SECRET: "corta" }), /TOKEN_SECRET/);
    assert.throws(() => keyring.tokenSecrets({ SESSION_SECRET: SESSION, TOKEN_SECRET_PREVIOUS: "corta" }), /TOKEN_SECRET_PREVIOUS/);
    // Vacía equivale a no definida.
    assert.equal(keyring.tokenSecret({ SESSION_SECRET: SESSION, TOKEN_SECRET: "  " }), SESSION);
    assert.throws(() => keyring.sessionSecret({}), /SESSION_SECRET/);
  });
});

describe("cifrado de secretos (ENCRYPTION_KEY)", () => {
  const onlySession = { SESSION_SECRET: SESSION };

  test("el formato antiguo (v1, sin id) se sigue leyendo sin configurar nada", () => {
    const old = legacyEncrypt("JBSWY3DPEHPK3PXP", SESSION);
    assert.deepEqual(keyring.decryptSecretInfo(old, onlySession), { plain: "JBSWY3DPEHPK3PXP", stale: true });
    assert.equal(keyring.decryptSecret(old, onlySession), "JBSWY3DPEHPK3PXP");
  });

  test("el formato nuevo lleva versión e id de la clave", () => {
    const enc = keyring.encryptSecret("hola", onlySession);
    const parts = enc.split(".");
    assert.equal(parts.length, 5);
    assert.equal(parts[0], "v2");
    assert.equal(parts[1], keyring.encryptionKeys(onlySession).current.id);
    assert.match(parts[1]!, /^[A-Za-z0-9_-]{8}$/);
    assert.deepEqual(keyring.decryptSecretInfo(enc, onlySession), { plain: "hola", stale: false });
    // Dos cifrados del mismo texto no coinciden (IV aleatorio).
    assert.notEqual(enc, keyring.encryptSecret("hola", onlySession));
  });

  test("sin ENCRYPTION_KEY, la clave es la de siempre (derivada de SESSION_SECRET)", () => {
    const viaSession = keyring.encryptionKeys(onlySession).current;
    const viaSameValue = keyring.encryptionKeys({ SESSION_SECRET: "otra".repeat(10), ENCRYPTION_KEY: SESSION }).current;
    assert.equal(viaSession.id, viaSameValue.id);
    assert.ok(viaSession.key.equals(Buffer.from(hkdfSync("sha256", SESSION, "tablon", "tablon-token-encryption-v1", 32))));
  });

  test("el id no revela la clave", () => {
    const { id, key } = keyring.encryptionKeys(onlySession).current;
    assert.ok(!key.toString("base64url").includes(id));
    assert.ok(!SESSION.includes(id));
  });

  test("con ENCRYPTION_KEY, rotar SESSION_SECRET no rompe lo cifrado", () => {
    const enc = keyring.encryptSecret("refresh-token", { SESSION_SECRET: SESSION, ENCRYPTION_KEY: ENC });
    assert.equal(keyring.decryptSecret(enc, { SESSION_SECRET: "n".repeat(48), ENCRYPTION_KEY: ENC }), "refresh-token");
  });

  test("separar las claves copiando el valor de SESSION_SECRET a ENCRYPTION_KEY: todo sigue legible y al día", () => {
    const before = keyring.encryptSecret("totp", onlySession);
    const after = { SESSION_SECRET: "n".repeat(48), ENCRYPTION_KEY: SESSION };
    assert.deepEqual(keyring.decryptSecretInfo(before, after), { plain: "totp", stale: false });
    assert.equal(keyring.decryptSecret(legacyEncrypt("totp", SESSION), after), "totp");
  });

  test("cambiar la clave sin la anterior: no se puede descifrar (y se dice por qué)", () => {
    const enc = keyring.encryptSecret("x", { SESSION_SECRET: SESSION, ENCRYPTION_KEY: ENC });
    assert.throws(() => keyring.decryptSecret(enc, { SESSION_SECRET: SESSION, ENCRYPTION_KEY: ENC2 }), /ya no está configurada/);
    assert.throws(() => keyring.decryptSecret(legacyEncrypt("x", SESSION), { SESSION_SECRET: SESSION, ENCRYPTION_KEY: ENC2 }), /ya no está configurada/);
  });

  test("ENCRYPTION_KEY_PREVIOUS: lo cifrado con la anterior se lee y se marca para re-cifrar", () => {
    const old = keyring.encryptSecret("secreto", { SESSION_SECRET: SESSION, ENCRYPTION_KEY: ENC });
    const env = { SESSION_SECRET: SESSION, ENCRYPTION_KEY: ENC2, ENCRYPTION_KEY_PREVIOUS: ENC };
    assert.deepEqual(keyring.decryptSecretInfo(old, env), { plain: "secreto", stale: true });
    const fresh = keyring.reencryptIfStale(old, env);
    assert.ok(fresh);
    assert.equal(fresh!.split(".")[1], keyring.encryptionKeys(env).current.id);
    assert.deepEqual(keyring.decryptSecretInfo(fresh!, { SESSION_SECRET: SESSION, ENCRYPTION_KEY: ENC2 }), { plain: "secreto", stale: false });
    assert.equal(keyring.reencryptIfStale(fresh!, env), null);
  });

  test("ENCRYPTION_KEY_PREVIOUS también abre el formato antiguo (v1)", () => {
    const old = legacyEncrypt("v1-secreto", SESSION);
    const env = { SESSION_SECRET: "n".repeat(48), ENCRYPTION_KEY: ENC, ENCRYPTION_KEY_PREVIOUS: SESSION };
    assert.deepEqual(keyring.decryptSecretInfo(old, env), { plain: "v1-secreto", stale: true });
  });

  test("valores manipulados o mal formados se rechazan", () => {
    const enc = keyring.encryptSecret("dato", onlySession);
    const parts = enc.split(".");
    const tampered = [...parts.slice(0, 4), Buffer.from("otro").toString("base64url")].join(".");
    assert.throws(() => keyring.decryptSecret(tampered, onlySession));
    for (const bad of ["", "v1", "v2.a.b", "v3.a.b.c.d", "v2..b.c.d", "texto en claro"]) assert.throws(() => keyring.decryptSecret(bad, onlySession), bad);
  });

  test("las funciones de la app (process.env) cifran con id y leen lo antiguo", async () => {
    const crypto = await import("../src/lib/crypto");
    assert.equal(crypto.decryptSecret(legacyEncrypt("legado", SESSION)), "legado");
    assert.match(crypto.encryptSecret("nuevo"), /^v2\.[A-Za-z0-9_-]{8}\./);
  });
});

/** BD en memoria con la forma mínima que usa la rotación. */
function fakeDb(data: Record<string, Record<string, string | null>[]>) {
  const delegate = (model: string) => {
    const idField = model === "appState" ? "key" : "id";
    return {
      async findMany({ where, select }: { where: Record<string, unknown>; select: Record<string, true> }) {
        const field = Object.keys(select).find((k) => k !== idField)!;
        // Filtros fijos (p. ej. la clave de AppState) y «no nulo» sobre el campo cifrado.
        const fixed = Object.entries(where).filter(([k]) => k !== field);
        return (data[model] ?? [])
          .filter((r) => r[field] != null && fixed.every(([k, v]) => r[k] === v))
          .map((r) => Object.fromEntries(Object.keys(select).map((k) => [k, r[k] ?? null])) as Record<string, string | null>);
      },
      async updateMany({ where, data: patch }: { where: Record<string, unknown>; data: Record<string, string> }) {
        const rows = (data[model] ?? []).filter((r) => Object.entries(where).every(([k, v]) => r[k] === v));
        for (const r of rows) Object.assign(r, patch);
        return { count: rows.length };
      },
    };
  };
  return { user: delegate("user"), loginChallenge: delegate("loginChallenge"), googleAccount: delegate("googleAccount"), appState: delegate("appState") };
}

describe("comando de rotación (rotate-keys)", () => {
  const prevEnv = { SESSION_SECRET: SESSION, ENCRYPTION_KEY: ENC };
  const env = { SESSION_SECRET: SESSION, ENCRYPTION_KEY: ENC2, ENCRYPTION_KEY_PREVIOUS: ENC };

  test("cubre todos los campos cifrados del esquema", () => {
    assert.deepEqual(ENCRYPTED_FIELDS.map((f) => `${f.model}.${f.field}`), ["user.totpSecretEnc", "loginChallenge.pendingSecretEnc", "googleAccount.refreshTokenEnc", "googleAccount.accessTokenEnc", "appState.value", "appState.value"]);
  });

  test("re-cifra lo antiguo con la clave actual, deja lo que ya está al día y cuenta lo ilegible", async () => {
    const data = {
      user: [
        { id: "u1", totpSecretEnc: keyring.encryptSecret("T1", prevEnv) },
        { id: "u2", totpSecretEnc: legacyEncrypt("T2", ENC) },
        { id: "u3", totpSecretEnc: keyring.encryptSecret("T3", env) },
        { id: "u4", totpSecretEnc: null },
        { id: "u5", totpSecretEnc: keyring.encryptSecret("perdido", { SESSION_SECRET: SESSION, ENCRYPTION_KEY: "g".repeat(48) }) },
      ],
      loginChallenge: [],
      googleAccount: [{ id: "g1", refreshTokenEnc: legacyEncrypt("R1", ENC), accessTokenEnc: keyring.encryptSecret("A1", prevEnv) }],
      // La contraseña SMTP guardada en Ajustes; las demás filas de AppState no se tocan.
      appState: [{ key: "mail.passEnc", value: keyring.encryptSecret("smtp-pass", prevEnv) }, { key: "google.clientSecretEnc", value: keyring.encryptSecret("g-secret", prevEnv) }, { key: "mail.host", value: "smtp.example.com" }],
    };
    const u3Before = data.user[2]!.totpSecretEnc;
    const db = fakeDb(data);

    const dry = await rotateEncryptedSecrets(db, { dryRun: true, env });
    assert.deepEqual(dry[0], { label: ENCRYPTED_FIELDS[0]!.label, total: 4, current: 1, rotated: 2, unreadable: 1 });
    // En seco no se toca nada.
    assert.ok(data.user[1]!.totpSecretEnc!.startsWith("v1."));

    const counts = await rotateEncryptedSecrets(db, { env });
    assert.deepEqual(counts.map((c) => [c.total, c.current, c.rotated, c.unreadable]), [[4, 1, 2, 1], [0, 0, 0, 0], [1, 0, 1, 0], [1, 0, 1, 0], [1, 0, 1, 0], [1, 0, 1, 0]]);
    // Todo lo legible queda con la clave nueva y se abre SIN la anterior.
    const onlyNew = { SESSION_SECRET: SESSION, ENCRYPTION_KEY: ENC2 };
    assert.equal(keyring.decryptSecret(data.user[0]!.totpSecretEnc!, onlyNew), "T1");
    assert.equal(keyring.decryptSecret(data.user[1]!.totpSecretEnc!, onlyNew), "T2");
    assert.equal(data.user[2]!.totpSecretEnc, u3Before);
    assert.equal(keyring.decryptSecret(data.googleAccount[0]!.refreshTokenEnc!, onlyNew), "R1");
    assert.equal(keyring.decryptSecret(data.googleAccount[0]!.accessTokenEnc!, onlyNew), "A1");
    assert.equal(keyring.decryptSecret(data.appState[0]!.value!, onlyNew), "smtp-pass");
    assert.equal(keyring.decryptSecret(data.appState[1]!.value!, onlyNew), "g-secret");
    assert.equal(data.appState[2]!.value, "smtp.example.com");
    // Repetirlo no cambia nada.
    const again = await rotateEncryptedSecrets(db, { env: onlyNew });
    assert.deepEqual(again.map((c) => c.rotated), [0, 0, 0, 0, 0, 0]);
  });

  test("si la app cambia el valor mientras tanto, no se pisa", async () => {
    const data = { user: [{ id: "u1", totpSecretEnc: keyring.encryptSecret("T1", prevEnv) }], loginChallenge: [], googleAccount: [], appState: [] };
    const db = fakeDb(data);
    const realUpdate = db.user.updateMany;
    db.user.updateMany = async (args) => {
      data.user[0]!.totpSecretEnc = keyring.encryptSecret("cambiado", env);
      return realUpdate(args);
    };
    const [c] = await rotateEncryptedSecrets(db, { env });
    assert.equal(c!.rotated, 0);
    assert.equal(keyring.decryptSecret(data.user[0]!.totpSecretEnc!, env), "cambiado");
  });
});
