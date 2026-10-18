import assert from "node:assert/strict";
import { test } from "node:test";

process.env.SESSION_SECRET = "x".repeat(48);
process.env.WHATSAPP_TEMPLATE_NAME = "mencion_tablon";
// notify importa el cliente de BD; no se conecta hasta la primera consulta.
process.env.DATABASE_URL ??= "postgresql://test:test@localhost:5432/test";

const { encryptSecret, decryptSecret } = await import("../src/lib/crypto");
const { mentionEmail, whatsappPayload } = await import("../src/lib/notify");
const { phoneE164 } = await import("../src/lib/validation");

test("cifrado AES-GCM de tokens", () => {
  const enc = encryptSecret("1//refresh-token");
  assert.notEqual(enc, encryptSecret("1//refresh-token"), "IV aleatorio");
  assert.equal(decryptSecret(enc), "1//refresh-token");
  const tampered = enc.slice(0, -2) + (enc.endsWith("A") ? "B" : "A") + enc.slice(-1);
  assert.throws(() => decryptSecret(tampered));
});

const msg = { actorName: "Ana <script>", taskTitle: "Pantalla", projectName: "Web", excerpt: "Mira esto & dime", url: "https://app.example.com/p/1?task=2" };

test("email de mención escapa HTML", () => {
  const m = mentionEmail(msg);
  assert.match(m.subject, /Ana <script> te ha mencionado/);
  assert.ok(m.html.includes("Ana &lt;script&gt;"));
  assert.ok(!m.html.includes("<script>"));
  assert.ok(m.text.includes(msg.url));
});

test("payload de WhatsApp con plantilla y 4 parámetros", () => {
  const p = whatsappPayload("+34600111222", msg);
  assert.equal(p.to, "34600111222");
  assert.equal(p.template.name, "mencion_tablon");
  assert.equal(p.template.language.code, "es");
  assert.deepEqual(p.template.components[0]!.parameters.map((x) => x.text), ["Ana <script>", "Pantalla", "Web", msg.url]);
});

test("teléfono E.164", () => {
  assert.equal(phoneE164.parse(" +34 600 11 12 22 "), "+34600111222");
  assert.equal(phoneE164.parse(""), null);
  assert.equal(phoneE164.safeParse("600111222").success, false);
});
