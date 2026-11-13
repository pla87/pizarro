// Acciones de servidor lanzadas dentro de una transición: sin red lanzan, y dentro de startTransition ese error llegaba a
// la pantalla «Algo ha fallado». Guarda: un componente que llama a acciones con useTransition() debe recoger el error
// (useActionTransition o `.catch((e) => actionThrowResult(e, t))`). Prueba en navegador: e2e/r49-infra-e2e.mjs.
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

/** useTransition() que no lanza acciones (o ya las recoge a mano). */
const ALLOWED = new Map([
  [path.join("src", "components", "calendar", "CalendarView.tsx"), "la transición solo navega (router.push)"],
  [path.join("src", "app", "login", "verify", "BackToLogin.tsx"), "cancelSecondStep().catch(() => {}) y recarga"],
]);

test("los componentes que lanzan acciones en una transición recogen el error de red", () => {
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const p = path.join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (name.endsWith(".tsx")) files.push(p);
    }
  };
  walk("src");
  const offenders = files.filter((f) => {
    const src = readFileSync(f, "utf8");
    return /\buseTransition\(\)/.test(src) && src.includes('from "@/actions/') && !/actionThrow(Result|Message)/.test(src) && !ALLOWED.has(f);
  });
  assert.deepEqual(offenders, [], "usa useActionTransition() (src/components/useActionTransition.ts) en lugar de useTransition()");
  // El ayudante existe y recoge los errores con el mismo mensaje que el resto de la app.
  const hook = readFileSync("src/components/useActionTransition.ts", "utf8");
  assert.match(hook, /actionThrowMessage\(err, t\)/);
  assert.match(hook, /NEXT_/);
});

test("deshacer «Enviar a la papelera» de un documento recoge el error (antes, .then sin catch)", () => {
  const src = readFileSync(path.join("src", "app", "(app)", "p", "[projectId]", "docs", "DocsManager.tsx"), "utf8");
  assert.doesNotMatch(src, /restoreDocument\([^)]*\)\.then\(/);
  for (const m of src.matchAll(/await (deleteDocument|restoreDocument|deleteDocumentForever|renameDocument)\([^)]*\)(.{0,12})/g)) {
    assert.match(m[2] ?? "", /^\.catch/, `${m[1]} sin .catch`);
  }
});
