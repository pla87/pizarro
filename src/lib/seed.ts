import type { PrismaClient } from "@/generated/prisma/client";
import { DEFAULT_COLUMNS } from "./constants";
import { hashPassword, MIN_PASSWORD } from "./password";
import { POSITION_STEP } from "./positions";

export const DEFAULT_HEADER_TEMPLATE = `> **Contexto para la IA:** a partir de la lista de cambios siguiente, redacta unas notas de versión claras para el equipo, agrupadas por tipo y sin jerga innecesaria.`;

export const DEFAULT_FOOTER_TEMPLATE = `---

**Checklist de cierre**

- [ ] Migraciones de base de datos aplicadas
- [ ] Prueba rápida en producción
- [ ] Comunicado enviado al equipo`;

/**
 * Seed idempotente:
 * - Si no hay usuarios, crea el administrador inicial con SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD.
 * - Si no hay proyectos, crea un proyecto de ejemplo con las columnas por defecto.
 */
export async function seed(db: PrismaClient, log: (msg: string) => void = console.log): Promise<void> {
  let admin = await db.user.findFirst({ where: { role: "ADMIN" }, orderBy: { createdAt: "asc" }, select: { id: true } });

  if ((await db.user.count()) === 0) {
    const email = process.env.SEED_ADMIN_EMAIL?.trim().toLowerCase();
    const password = process.env.SEED_ADMIN_PASSWORD;
    const name = process.env.SEED_ADMIN_NAME?.trim() || "Administrador";
    if (!email || !password) {
      log("[seed] No hay usuarios. Define SEED_ADMIN_EMAIL y SEED_ADMIN_PASSWORD para crear el administrador inicial.");
      return;
    }
    if (password.length < MIN_PASSWORD) throw new Error(`SEED_ADMIN_PASSWORD debe tener al menos ${MIN_PASSWORD} caracteres.`);
    admin = await db.user.create({
      data: {
        email,
        name,
        role: "ADMIN",
        passwordHash: await hashPassword(password),
        releaseHeaderTemplate: DEFAULT_HEADER_TEMPLATE,
        releaseFooterTemplate: DEFAULT_FOOTER_TEMPLATE,
      },
      select: { id: true },
    });
    log(`[seed] Administrador inicial creado (${email}).`);
  }

  if ((await db.project.count()) === 0) {
    const project = await db.project.create({
      data: {
        name: "Proyecto de ejemplo",
        description: "Proyecto creado por el seed inicial. Puedes renombrarlo o borrarlo.",
        position: POSITION_STEP,
        columns: { create: DEFAULT_COLUMNS.map((c, i) => ({ ...c, position: (i + 1) * POSITION_STEP })) },
        labels: {
          create: [
            { name: "Frontend", color: "#0ea5e9" },
            { name: "Backend", color: "#6366f1" },
            { name: "Urgente", color: "#ef4444" },
          ],
        },
      },
      select: { id: true, columns: { orderBy: { position: "asc" }, select: { id: true } } },
    });
    const [backlog, progress, next] = project.columns;
    const samples = [
      { column: backlog, title: "Definir los criterios de aceptación del nuevo informe", type: "FEATURE" as const },
      { column: backlog, title: "Actualizar dependencias del proyecto", type: "CHORE" as const },
      { column: progress, title: "Pantalla de exportación de datos", type: "FEATURE" as const, assign: true },
      { column: next, title: "Corregir el cálculo de totales en el resumen", type: "FIX" as const, link: "https://example.com/issues/1" },
      { column: next, title: "Extraer el servicio de notificaciones", type: "REFACTOR" as const },
      { column: next, title: "Añadir filtro por fecha en el listado", type: "FEATURE" as const },
    ];
    let pos = 0;
    for (const s of samples) {
      if (!s.column) continue;
      await db.task.create({
        data: {
          projectId: project.id,
          columnId: s.column.id,
          title: s.title,
          type: s.type,
          linkUrl: s.link ?? null,
          position: (pos += POSITION_STEP),
          assigneeId: s.assign ? admin?.id : null,
          createdById: admin?.id,
          description: s.assign ? "Descripción de ejemplo con **Markdown**.\n\n- Punto uno\n- Punto dos" : "",
          subtasks: s.assign
            ? { create: [{ title: "Diseño", done: true, position: 1 }, { title: "Implementación", position: 2 }, { title: "Pruebas", position: 3 }] }
            : undefined,
        },
      });
    }
    log("[seed] Proyecto de ejemplo creado.");
  }
}
