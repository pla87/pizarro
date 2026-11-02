import { readdirSync, readFileSync } from "node:fs";
const OUT = process.env.MAIL_OUTBOX_DIR || "./outbox";
const lastCode = () => { const f = readdirSync(OUT).filter((x) => x.endsWith(".json")).sort().pop(); return (JSON.parse(readFileSync(`${OUT}/${f}`, "utf8")).text.match(/\b\d{6}\b/) || [])[0]; };
export async function login(p, base, email = "admin@example.com", pass = "cambia-esta-clave") {
  await p.goto(base + "/login"); await p.fill("#email", email); await p.fill("#password", pass); await p.click("button[type=submit]");
  await p.waitForTimeout(1800);
  if (!p.url().includes("/login/verify")) return;
  if (await p.locator("button:has-text('Código por email')").count()) {
    await p.click("button:has-text('Código por email')"); await p.waitForTimeout(1200);
    await p.fill("#enroll-code", lastCode()); await p.click("button:has-text('Activar')"); await p.waitForTimeout(1500);
    await p.locator("input[type=checkbox]").first().check(); await p.locator("button:has-text('Entrar'), button:has-text('Continuar')").first().click();
  } else {
    await p.waitForTimeout(500); const inp = p.locator("input[autocomplete=one-time-code]").first(); await inp.fill(lastCode()); await p.keyboard.press("Enter");
  }
  await p.waitForTimeout(2000);
}
