import type { PrismaClient } from "@/generated/prisma/client";
import { defaultColumns } from "./constants";
import { INSTANCE_LOCALE_KEY } from "./instance-core";
import { hashPassword, MIN_PASSWORD } from "./password";
import { POSITION_STEP } from "./positions";

type SeedLocale = "es" | "en";

// Textos del primer administrador y del proyecto de ejemplo en los dos idiomas (sin pasar por el diccionario: este
// módulo lo empaqueta también dist/boot.mjs). Se crean en el idioma de la instalación.
const TEXT = {
  es: {
    headerName: "Contexto para IA",
    header: `> **Contexto para la IA:** a partir de la lista de cambios siguiente, redacta unas notas de versión claras para el equipo, agrupadas por tipo y sin jerga innecesaria.`,
    footerName: "Checklist de cierre",
    footer: `---

**Checklist de cierre**

- [ ] Migraciones de base de datos aplicadas
- [ ] Prueba rápida en producción
- [ ] Comunicado enviado al equipo`,
    project: "Proyecto de ejemplo",
    projectDescription: "Un proyecto para ir probando Pizarro. Puedes cambiarle el nombre o borrarlo cuando quieras.",
    labels: ["Frontend", "Backend", "Urgente"],
    deliverable: "Beta cerrada",
    deliverableDescription: "Primera versión para un grupo reducido de usuarios.",
    featureKind: "Funcionalidad",
    tasks: [
      "Definir los criterios de aceptación del nuevo informe",
      "Actualizar dependencias del proyecto",
      "Pantalla de exportación de datos",
      "Corregir el cálculo de totales en el resumen",
      "Extraer el servicio de notificaciones",
      "Añadir filtro por fecha en el listado",
    ],
    description: "Descripción de ejemplo con **Markdown**.\n\n- Punto uno\n- Punto dos",
    subtasks: ["Diseño", "Implementación", "Pruebas"],
  },
  en: {
    headerName: "AI context",
    header: `> **Context for the AI:** from the list of changes below, write clear release notes for the team, grouped by type and without unnecessary jargon.`,
    footerName: "Release checklist",
    footer: `---

**Release checklist**

- [ ] Database migrations applied
- [ ] Quick check in production
- [ ] Announcement sent to the team`,
    project: "Example project",
    projectDescription: "A project for trying out Pizarro. You can rename it or delete it whenever you like.",
    labels: ["Frontend", "Backend", "Urgent"],
    deliverable: "Closed beta",
    deliverableDescription: "First version for a small group of users.",
    featureKind: "Feature",
    tasks: [
      "Define the acceptance criteria for the new report",
      "Update the project dependencies",
      "Data export screen",
      "Fix the totals calculation in the summary",
      "Extract the notification service",
      "Add a date filter to the list",
    ],
    description: "Example description with **Markdown**.\n\n- Point one\n- Point two",
    subtasks: ["Design", "Implementation", "Testing"],
  },
} as const satisfies Record<SeedLocale, unknown>;

/** Idioma de la instalación guardado por el asistente /setup (español si no hay ninguno). */
async function installationLocale(db: Pick<PrismaClient, "appState">): Promise<SeedLocale> {
  const row = await db.appState.findUnique({ where: { key: INSTANCE_LOCALE_KEY }, select: { value: true } });
  return row?.value === "en" ? "en" : "es";
}

/** Crea el primer administrador con sus plantillas de release por defecto (seed por variables y asistente /setup). */
export async function createInitialAdmin(
  db: Pick<PrismaClient, "user">,
  data: { email: string; name: string; passwordHash: string; locale?: "ES" | "EN" },
): Promise<{ id: string }> {
  const text = TEXT[data.locale === "EN" ? "en" : "es"];
  return db.user.create({
    data: {
      email: data.email,
      name: data.name,
      role: "ADMIN",
      passwordHash: data.passwordHash,
      ...(data.locale ? { locale: data.locale } : {}),
      releaseTemplates: {
        create: [
          { kind: "HEADER", name: text.headerName, content: text.header, position: POSITION_STEP },
          { kind: "FOOTER", name: text.footerName, content: text.footer, position: POSITION_STEP },
        ],
      },
    },
    select: { id: true },
  });
}

/**
 * Seed idempotente:
 * - Si no hay usuarios, crea el administrador inicial con SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD
 *   (sin esas variables lo crea el asistente web /setup).
 * - Si no hay proyectos, crea un proyecto de ejemplo con las columnas por defecto.
 * Todo en `locale` o, si no se indica, en el idioma de la instalación (español si aún no se ha elegido).
 */
export async function seed(db: PrismaClient, log: (msg: string) => void = console.log, locale?: SeedLocale): Promise<void> {
  const lang = locale ?? (await installationLocale(db));
  const text = TEXT[lang];
  let admin = await db.user.findFirst({ where: { role: "ADMIN" }, orderBy: { createdAt: "asc" }, select: { id: true } });

  if ((await db.user.count()) === 0) {
    const email = process.env.SEED_ADMIN_EMAIL?.trim().toLowerCase();
    const password = process.env.SEED_ADMIN_PASSWORD;
    const name = process.env.SEED_ADMIN_NAME?.trim() || "Administrador";
    if (!email || !password) {
      log("[seed] No hay usuarios: el administrador inicial se crea en el asistente web (/setup) o con SEED_ADMIN_EMAIL y SEED_ADMIN_PASSWORD.");
      return;
    }
    if (password.length < MIN_PASSWORD) throw new Error(`SEED_ADMIN_PASSWORD debe tener al menos ${MIN_PASSWORD} caracteres.`);
    admin = await createInitialAdmin(db, { email, name, passwordHash: await hashPassword(password), locale: lang === "en" ? "EN" : "ES" });
    log(`[seed] Administrador inicial creado (${email}).`);
  }

  if ((await db.project.count()) === 0) {
    const project = await db.project.create({
      data: {
        name: text.project,
        description: text.projectDescription,
        position: POSITION_STEP,
        // Los administradores trabajan en él desde el principio (si no, no les saldría en los menús).
        adminPicks: { create: (await db.user.findMany({ where: { role: "ADMIN" }, select: { id: true } })).map((u) => ({ userId: u.id })) },
        columns: { create: defaultColumns(lang).map((c, i) => ({ ...c, position: (i + 1) * POSITION_STEP })) },
        labels: {
          create: [
            { name: text.labels[0], color: "#0ea5e9" },
            { name: text.labels[1], color: "#6366f1" },
            { name: text.labels[2], color: "#ef4444" },
          ],
        },
      },
      select: { id: true, columns: { orderBy: { position: "asc" }, select: { id: true } } },
    });
    const [backlog, progress, next] = project.columns;
    // Fechas relativas a hoy para que el ejemplo muestre plazos vencidos, próximos y futuros.
    const inDays = (n: number) => new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate() + n));
    const beta = await db.deliverable.create({
      data: { projectId: project.id, name: text.deliverable, description: text.deliverableDescription, dueDate: inDays(10), position: POSITION_STEP },
      select: { id: true },
    });
    // Los tipos base los crea la migración; si un admin los cambió, se usan los dos primeros.
    const kinds = await db.taskKind.findMany({ where: { projectId: null }, orderBy: { position: "asc" }, select: { id: true } });
    const featureKind = kinds[0] ?? (await db.taskKind.create({ data: { name: text.featureKind, color: "#22c55e", position: POSITION_STEP }, select: { id: true } }));
    const fixKind = kinds[1] ?? featureKind;
    const samples = [
      { column: backlog, title: text.tasks[0], fix: false, due: 21 },
      { column: backlog, title: text.tasks[1], fix: false },
      { column: progress, title: text.tasks[2], fix: false, assign: true, due: 3, beta: true },
      { column: next, title: text.tasks[3], fix: true, link: "https://example.com/issues/1", due: -2, beta: true },
      { column: next, title: text.tasks[4], fix: false, beta: true },
      { column: next, title: text.tasks[5], fix: false, due: 7 },
    ];
    let pos = 0;
    for (const s of samples) {
      if (!s.column) continue;
      await db.task.create({
        data: {
          projectId: project.id,
          columnId: s.column.id,
          title: s.title,
          kindId: (s.fix ? fixKind : featureKind).id,
          linkUrl: s.link ?? null,
          dueDate: s.due !== undefined ? inDays(s.due) : null,
          deliverableId: s.beta ? beta.id : null,
          position: (pos += POSITION_STEP),
          assigneeId: s.assign ? admin?.id : null,
          createdById: admin?.id,
          description: s.assign ? text.description : "",
          subtasks: s.assign
            ? { create: text.subtasks.map((title, i) => ({ title, done: i === 0, position: i + 1 })) }
            : undefined,
        },
      });
    }
    log("[seed] Proyecto de ejemplo creado.");
  }
}
