// Cookie de dispositivos conocidos (src/lib/devices.ts): una marca aleatoria por cuenta en el mismo navegador, sin que la
// de una cuenta sirva para otra ni se pueda plantar; tope de marcas; cookie de antes; __Host- con HTTPS. Contra PostgreSQL real.
import assert from "node:assert/strict";
import { afterEach, describe, test } from "node:test";
import { db, logout, makeUser } from "./helpers";
import { completeLogin } from "../../src/lib/login";
import { hashDeviceId } from "../../src/lib/auth-token-core";
import { isKnownDevice, isTrustedDevice, registerDevice, TRUST_DEVICE_DAYS } from "../../src/lib/devices";
import { deviceCookieName, LEGACY_DEVICE_COOKIE } from "../../src/lib/session-config";

const jar = (globalThis as unknown as { __pzTestRequest: { jar: Map<string, string> } }).__pzTestRequest.jar;
const NAME = "pz_device"; // sin HTTPS (npm run test:db fija COOKIE_SECURE=false)
const ids = () => (jar.get(NAME) ?? "").split(".").filter(Boolean);
const enter = (user: { id: string; name: string; email: string }, rememberDevice = false) =>
  completeLogin({ ...user, locale: "ES", mustChangePassword: false }, { method: "password+2fa", rememberDevice, path: "/login/verify" });
/** Solo la cookie de dispositivos: como un navegador del que se ha cerrado la sesión. */
const keepOnlyDevices = () => {
  const devices = jar.get(NAME);
  logout();
  if (devices !== undefined) jar.set(NAME, devices);
};

describe("cookie de dispositivo al iniciar sesión", () => {
  test("un valor plantado desde fuera no se adopta: se genera otro y con «Recordar» la confianza va al nuevo", async () => {
    const victim = await makeUser();
    const planted = "plantado-por-un-tercero-0123456789";
    logout();
    jar.set(NAME, planted);
    await enter(victim, true);
    const [issued] = ids();
    assert.ok(issued && issued !== planted, "la marca de la cuenta es nueva y va delante");
    assert.ok(Buffer.from(issued, "base64url").length >= 32);
    const devices = await db.knownDevice.findMany({ where: { userId: victim.id } });
    assert.deepEqual(devices.map((d) => d.deviceHash), [hashDeviceId(issued)]);
    assert.ok(devices[0]!.trustedUntil && devices[0]!.trustedUntil > new Date());
    // Quien plantó el valor no se salta el segundo paso con él.
    logout();
    jar.set(NAME, planted);
    assert.equal(await isTrustedDevice(victim.id), false);
    assert.equal(await isKnownDevice(victim.id), false);
    jar.set(NAME, issued);
    assert.equal(await isTrustedDevice(victim.id), true);
  });

  test("un dispositivo ya conocido de la cuenta conserva su marca (sin fila nueva); el de otra cuenta no vale", async () => {
    const user = await makeUser();
    const other = await makeUser();
    logout();
    await enter(user);
    const [mine] = ids();
    await enter(user, true);
    assert.deepEqual(ids(), [mine], "se adopta: es de esta cuenta");
    const rows = await db.knownDevice.findMany({ where: { userId: user.id } });
    assert.equal(rows.length, 1);
    assert.ok(rows[0]!.trustedUntil, "«Recordar» marca el mismo dispositivo");
    // Con la marca de esta cuenta, otra cuenta recibe una propia y la primera se conserva detrás.
    await enter(other);
    const [theirs, kept] = ids();
    assert.notEqual(theirs, mine);
    assert.equal(kept, mine);
    assert.deepEqual((await db.knownDevice.findMany({ where: { userId: other.id } })).map((d) => d.deviceHash), [hashDeviceId(theirs!)]);
  });
});

describe("dos cuentas en el mismo navegador", () => {
  test("al turnarse, ninguna pierde su «Recordar» ni recibe el aviso de dispositivo nuevo", async () => {
    const ana = await makeUser();
    const bea = await makeUser();
    // Cada una tiene ya otro dispositivo: un dispositivo nuevo avisaría.
    for (const u of [ana, bea]) await db.knownDevice.create({ data: { userId: u.id, deviceHash: `otro-${u.id}` } });
    logout();
    assert.deepEqual(await registerDevice(ana.id, { trustDays: TRUST_DEVICE_DAYS }), { alert: true }, "primera vez aquí: aviso");
    keepOnlyDevices();
    assert.deepEqual(await registerDevice(bea.id, { trustDays: TRUST_DEVICE_DAYS }), { alert: true });
    for (let round = 0; round < 3; round++) {
      keepOnlyDevices();
      assert.equal(await isTrustedDevice(ana.id), true, `vuelta ${round}: Ana sigue recordada`);
      assert.deepEqual(await registerDevice(ana.id), { alert: false });
      keepOnlyDevices();
      assert.equal(await isTrustedDevice(bea.id), true, `vuelta ${round}: Bea sigue recordada`);
      assert.deepEqual(await registerDevice(bea.id), { alert: false });
    }
    assert.equal(ids().length, 2);
    assert.equal(await db.knownDevice.count({ where: { userId: { in: [ana.id, bea.id] } } }), 4, "una fila por cuenta y dispositivo");
  });

  test("la marca de una cuenta no sirve para otra, ni copiada a mano", async () => {
    const ana = await makeUser();
    const bea = await makeUser();
    logout();
    await registerDevice(ana.id, { trustDays: TRUST_DEVICE_DAYS });
    const [anaId] = ids();
    logout();
    jar.set(NAME, anaId!);
    assert.equal(await isKnownDevice(ana.id), true);
    assert.equal(await isKnownDevice(bea.id), false);
    assert.equal(await isTrustedDevice(bea.id), false);
    // Bea entra con la marca de Ana en el navegador: no la adopta, recibe una propia.
    await registerDevice(bea.id, { trustDays: TRUST_DEVICE_DAYS });
    const [beaId] = ids();
    assert.notEqual(beaId, anaId);
    assert.equal(await db.knownDevice.count({ where: { userId: bea.id, deviceHash: hashDeviceId(anaId!) } }), 0);
  });

  test("tope de marcas: con una cuenta más se olvida la que lleva más tiempo sin entrar; nada mal formado ni repetido", async () => {
    const users = await Promise.all(Array.from({ length: 9 }, () => makeUser()));
    logout();
    for (const u of users) {
      await registerDevice(u.id);
      keepOnlyDevices();
    }
    assert.equal(ids().length, 8);
    assert.ok((jar.get(NAME) ?? "").length <= 8 * 44, "la cookie no crece sin límite");
    assert.equal(await isKnownDevice(users[0]!.id), false, "la más antigua ya no está");
    for (const u of users.slice(1)) assert.equal(await isKnownDevice(u.id), true);
    // Basura, repetidas y marcas de más: se ignoran (y no se reescriben).
    const good = ids();
    jar.set(NAME, ["x", good[0], good[0], "con espacios no vale 0123456789", "a".repeat(101), ...good].join("."));
    assert.equal(await isKnownDevice(users[8]!.id), true);
    await registerDevice(users[8]!.id);
    assert.deepEqual(ids(), good);
  });

  test("una cookie de antes (una sola marca) se reconoce: sin aviso y conservando «Recordar»", async () => {
    const user = await makeUser();
    await db.knownDevice.create({ data: { userId: user.id, deviceHash: `otro-${user.id}` } });
    const old = "AbCdEfGhIjKlMnOpQrStUvWxYz0123456789-_abcde";
    await db.knownDevice.create({ data: { userId: user.id, deviceHash: hashDeviceId(old), trustedUntil: new Date(Date.now() + 86_400_000) } });
    logout();
    jar.set(NAME, old);
    assert.equal(await isTrustedDevice(user.id), true);
    assert.deepEqual(await registerDevice(user.id), { alert: false });
    assert.deepEqual(ids(), [old]);
  });
});

describe("con HTTPS: __Host-pz_device", () => {
  const prev = process.env.COOKIE_SECURE;
  afterEach(() => {
    if (prev === undefined) delete process.env.COOKIE_SECURE;
    else process.env.COOKIE_SECURE = prev;
  });

  test("se escribe con el prefijo; la de antes se lee mientras falte la nueva y después se borra", async () => {
    process.env.COOKIE_SECURE = "true";
    assert.equal(deviceCookieName(), "__Host-pz_device");
    const user = await makeUser();
    await db.knownDevice.create({ data: { userId: user.id, deviceHash: `otro-${user.id}` } });
    const old = "ZyXwVuTsRqPoNmLkJiHgFeDcBa9876543210_-edcba";
    await db.knownDevice.create({ data: { userId: user.id, deviceHash: hashDeviceId(old), trustedUntil: new Date(Date.now() + 86_400_000) } });
    logout();
    jar.set(LEGACY_DEVICE_COOKIE, old);
    assert.equal(await isTrustedDevice(user.id), true, "la de antes vale mientras no hay __Host-");
    assert.deepEqual(await registerDevice(user.id), { alert: false });
    assert.equal(jar.get("__Host-pz_device"), old);
    assert.ok(!jar.get(LEGACY_DEVICE_COOKIE), "la de antes se borra");
    // Con la nueva presente, la de antes (que un subdominio podría plantar) no cuenta.
    const other = await makeUser();
    await registerDevice(other.id);
    const otherId = jar.get("__Host-pz_device")!.split(".")[0]!;
    jar.set("__Host-pz_device", old);
    jar.set(LEGACY_DEVICE_COOKIE, otherId);
    assert.equal(await isKnownDevice(other.id), false);
    assert.equal(await isKnownDevice(user.id), true);
  });
});
