// Ajustes en memoria compartidos entre copias del módulo: Next carga una copia por bundle (las rutas /api, como las
// subidas, aparte de las acciones que guardan el ajuste). Con la caché en una variable del módulo, la invalidación al
// guardar no llegaba a la otra copia y el cambio tardaba hasta 30 s en aplicarse allí. Aquí la «otra copia» es el mismo
// fichero importado con otra URL (?bundle=api), que Node trata como un módulo distinto.
import assert from "node:assert/strict";
import { afterEach, describe, test } from "node:test";
import { db } from "./helpers";
import * as quotaA from "../../src/lib/quota-settings";
import * as appA from "../../src/lib/app-settings";
import * as instanceA from "../../src/lib/instance";

type Quota = typeof quotaA;
type App = typeof appA;
type Instance = typeof instanceA;
// @ts-expect-error -- la URL con consulta no la resuelve TypeScript; en ejecución es otra copia del módulo.
const quotaB = (await import("../../src/lib/quota-settings.ts?bundle=api")) as Quota;
// @ts-expect-error -- ídem
const appB = (await import("../../src/lib/app-settings.ts?bundle=api")) as App;
// @ts-expect-error -- ídem
const instanceB = (await import("../../src/lib/instance.ts?bundle=api")) as Instance;

afterEach(async () => {
  await db.appState.deleteMany({ where: { key: { in: [quotaA.QUOTA_PROJECT_KEY, quotaA.QUOTA_TOTAL_KEY, appA.COMMENT_LIMIT_KEY, instanceA.INSTANCE_LOCALE_KEY] } } });
  quotaA.invalidateQuotaSettings();
  appA.invalidateAppSettings();
  instanceA.invalidateInstance();
});

describe("cachés de ajustes entre bundles", () => {
  test("son copias distintas del módulo", () => {
    assert.notEqual(quotaA.getQuotaSettings, quotaB.getQuotaSettings);
  });

  test("la cuota guardada desde las acciones se aplica al momento en las rutas /api", async () => {
    const before = await quotaB.getQuotaLimits(null);
    await quotaA.saveQuotaSettings({ project: { mode: "custom", mb: 7 }, total: { mode: "custom", mb: 9 } });
    const after = await quotaB.getQuotaLimits(null);
    assert.notEqual(before.projectMb, 7);
    assert.equal(after.projectMb, 7);
    assert.equal(after.totalMb, 9);
  });

  test("el máximo de comentarios por tarea", async () => {
    assert.equal(await appB.getMaxCommentsPerTask(), appA.COMMENT_LIMIT_DEFAULT);
    await appA.setMaxCommentsPerTask(3);
    assert.equal(await appB.getMaxCommentsPerTask(), 3);
  });

  test("los ajustes de la instalación (idioma)", async () => {
    assert.equal((await instanceB.getInstanceSettings()).locale, "es");
    await db.appState.create({ data: { key: instanceA.INSTANCE_LOCALE_KEY, value: "en" } });
    instanceA.invalidateInstance();
    assert.equal((await instanceB.getInstanceSettings()).locale, "en");
  });
});
