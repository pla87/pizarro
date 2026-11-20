import type { Metadata } from "next";
import { cache } from "react";
import { visibleProjectsWhere } from "@/lib/access";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/session";

// Nombre del proyecto para el título de la pestaña, solo si quien mira tiene acceso (una consulta por petición).
const visibleProjectName = cache(async (projectId: string): Promise<string | null> => {
  const user = await getCurrentUser();
  if (!user) return null;
  const p = await db.project.findFirst({ where: { id: projectId, ...visibleProjectsWhere(user) }, select: { name: true } });
  return p?.name ?? null;
});

/**
 * Título de una pantalla de un proyecto: «Documentación · Web» (y la plantilla del layout añade «· Pizarro»). Sin acceso,
 * solo la sección: no se descubre el nombre de un proyecto ajeno probando su dirección.
 */
export async function projectSectionMetadata(params: Promise<{ projectId: string }>, section: string): Promise<Metadata> {
  const { projectId } = await params;
  const name = await visibleProjectName(projectId);
  return { title: name ? `${section} · ${name}` : section };
}
