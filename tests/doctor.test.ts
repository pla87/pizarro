// Diagnóstico para soporte (lib/doctor-core.ts): nunca valores de variables, emails ni nombres.
import assert from "node:assert/strict";
import { describe, test } from "node:test";

const {
  DOCUMENTED_ENV_VARS, configFlags, envPresence, groupLogCounts, migrationStatus, scrubDeep, scrubText, secretEnvValues,
} = await import("../src/lib/doctor-core");

const SECRET = "Zx9-very-secret-session-value-0123456789";
const env = {
  DATABASE_URL: "postgresql://pizarro:SuperClave123@db:5432/pizarro",
  SESSION_SECRET: SECRET,
  TOKEN_SECRET: "corta",
  BACKUP_KEY: "no-es-base64-de-32",
  SMTP_PASS: "clave-del-correo-123",
  SMTP_HOST: "smtp.example.com",
  SMTP_FROM: "Pizarro <avisos@example.com>",
  APP_URL: "https://pizarro.example.com",
  GOOGLE_CLIENT_ID: "1234567890-abc.apps.googleusercontent.com",
  GOOGLE_CLIENT_SECRET: "GOCSPX-secretodegoogle",
  AUTH_ALLOW_ADMIN_PASSWORD: "true",
  OTHER_UNDOCUMENTED: "lo que sea",
};

describe("presencia de variables", () => {
  test("solo set/unset/invalid, nunca el valor", () => {
    const p = envPresence(env);
    assert.deepEqual(Object.keys(p), [...DOCUMENTED_ENV_VARS]);
    assert.equal(p.SESSION_SECRET, "set");
    assert.equal(p.DATABASE_URL, "set");
    assert.equal(p.ENCRYPTION_KEY, "unset");
    assert.equal(p.TOKEN_SECRET, "invalid");
    assert.equal(p.BACKUP_KEY, "invalid");
    assert.equal(p.OTHER_UNDOCUMENTED, undefined);
    const json = JSON.stringify(p);
    for (const v of Object.values(env)) if (v.length > 4) assert.ok(!json.includes(v), v);
  });

  test("flags de configuración", () => {
    const f = configFlags(env);
    assert.equal(f.google, true);
    assert.equal(f.smtp, true);
    assert.equal(f.email, true);
    assert.equal(f.whatsapp, false);
    assert.equal(f.backups, false);
    assert.equal(f.separateTokenSecret, true);
    assert.equal(f.separateEncryptionKey, false);
    // El buzón de pruebas no cuenta en producción salvo que se permita.
    assert.equal(configFlags({ MAIL_OUTBOX_DIR: "/tmp/x", NODE_ENV: "production" }).email, false);
    assert.equal(configFlags({ MAIL_OUTBOX_DIR: "/tmp/x", NODE_ENV: "production", MAIL_OUTBOX_IN_PRODUCTION: "1" }).email, true);
  });

  test("valores a tachar: los de nombre secreto, no los inofensivos ni los cortos", () => {
    const vals = secretEnvValues(env);
    assert.ok(vals.includes(SECRET));
    assert.ok(vals.includes("clave-del-correo-123"));
    assert.ok(vals.includes(env.DATABASE_URL));
    assert.ok(vals.includes(env.GOOGLE_CLIENT_ID));
    assert.ok(!vals.includes("true"));
    assert.ok(!vals.includes("smtp.example.com"));
  });
});

describe("limpieza de textos", () => {
  const ctx = { literals: [...secretEnvValues(env), "Ana Pérez", "ana@example.com"], paths: { "/srv/pizarro/uploads": "[UPLOAD_DIR]" } };

  test("sin emails", () => {
    const s = scrubText("Fallo al enviar a persona@example.org y a Otra.Persona+x@sub.example.co.uk", ctx);
    assert.ok(!/@/.test(s.replace(/\[email\]/g, "")), s);
    assert.equal((s.match(/\[email\]/g) ?? []).length, 2);
  });

  test("sin valores de variables secretas, aunque aparezcan dentro de otro texto", () => {
    const s = scrubText(`error: clave ${SECRET} rechazada; smtp pass=clave-del-correo-123; ${env.DATABASE_URL}`, ctx);
    assert.ok(!s.includes(SECRET));
    assert.ok(!s.includes("clave-del-correo-123"));
    assert.ok(!s.includes("SuperClave123"));
    assert.ok(s.includes("[oculto]"));
  });

  test("credenciales de URL que no son variables conocidas", () => {
    const s = scrubText("connect ECONNREFUSED postgresql://usuario:otraclave@10.0.0.1:5432/db", ctx);
    assert.ok(!s.includes("usuario"));
    assert.ok(!s.includes("otraclave"));
    assert.ok(s.includes("postgresql://[oculto]@10.0.0.1"));
  });

  test("nombres de personas conocidas (sin distinguir mayúsculas), rutas y tokens largos", () => {
    const s = scrubText("Tarea de ANA PÉREZ falló en /srv/pizarro/uploads/backups con token abcdefghijklmnopqrstuvwxyz012345", ctx);
    assert.ok(!/ana p/i.test(s), s);
    assert.ok(s.includes("[UPLOAD_DIR]/backups"));
    assert.ok(s.includes("[token]"));
    assert.ok(!s.includes("abcdefghijklmnopqrstuvwxyz012345"));
  });

  test("recorta los textos largos", () => {
    assert.ok(scrubText("x ".repeat(1000), ctx).length <= 301);
  });

  test("objetos: quita campos sensibles y limpia los textos anidados", () => {
    const out = scrubDeep({
      lastBackup: { at: "2026-10-25T03:00:00.000Z", ok: false, error: `No se pudo escribir: ${SECRET}`, bytes: 12 },
      external: { ok: true, target: "s3://bucket", email: "admin@example.com", password: "x", token: "y", userName: "Ana" },
    }, ctx) as Record<string, Record<string, unknown>>;
    assert.equal(out.lastBackup!.bytes, 12);
    assert.equal(out.lastBackup!.ok, false);
    assert.ok(!String(out.lastBackup!.error).includes(SECRET));
    assert.deepEqual(Object.keys(out.external!), ["ok", "target"]);
  });

  test("pasada final: sin tachar tokens ni campos, pero sin secretos ni emails", () => {
    const report = { migrations: { pending: ["20261101130000_una_migracion_con_nombre_largo"] }, jobs: [{ name: "orphanFiles" }], note: `x ${SECRET} y a@example.com` };
    const out = scrubDeep(report, { literals: secretEnvValues(env), tokens: false, dropFields: false });
    const json = JSON.stringify(out);
    assert.ok(json.includes("20261101130000_una_migracion_con_nombre_largo"));
    assert.ok(json.includes("orphanFiles"));
    assert.ok(!json.includes(SECRET));
    assert.ok(!json.includes("a@example.com"));
  });
});

describe("migraciones y logs", () => {
  const applied = (name: string) => ({ migration_name: name, finished_at: new Date(), rolled_back_at: null });

  test("pendientes, desconocidas y fallidas", () => {
    const s = migrationStatus(
      ["20260101000000_a", "20260102000000_b", "20260103000000_c"],
      [applied("20260101000000_a"), applied("20259999000000_vieja"), { migration_name: "20260102000000_b", finished_at: null, rolled_back_at: null }],
    );
    assert.deepEqual(s, {
      folder: 3, applied: 2, pending: ["20260102000000_b", "20260103000000_c"], unknown: ["20259999000000_vieja"], failed: ["20260102000000_b"], folderFound: true,
    });
  });

  test("sin carpeta: solo lo aplicado", () => {
    const s = migrationStatus(null, [applied("20260101000000_a")]);
    assert.equal(s.folderFound, false);
    assert.equal(s.applied, 1);
    assert.deepEqual(s.pending, []);
  });

  test("errores y avisos agrupados por acción, sin mensajes, de más a menos", () => {
    const g = groupLogCounts([
      { level: "warn", action: "auth.loginFailed", _count: { _all: 3 } },
      { level: "error", action: "action.error", _count: { _all: 7 } },
      { level: "info", action: "auth.login", _count: { _all: 50 } },
    ]);
    assert.deepEqual(g, [{ level: "error", action: "action.error", count: 7 }, { level: "warn", action: "auth.loginFailed", count: 3 }]);
  });
});
