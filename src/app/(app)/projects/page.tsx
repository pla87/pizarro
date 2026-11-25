import { db } from "@/lib/db";
import { visibleProjectsWhere } from "@/lib/access";
import { sortProjects } from "@/lib/project-order";
import { requireAdminPage } from "@/lib/session";
import { getT } from "@/i18n/server";
import { ExistingProjects } from "./ExistingProjects";

export async function generateMetadata() {
  const t = await getT();
  return { title: t("Proyectos existentes") };
}

/** Proyectos de equipo a los que tiene acceso el administrador, con su elección de «proyectos en los que trabajo». */
export default async function ExistingProjectsPage() {
  const user = await requireAdminPage();
  const projects = await db.project.findMany({
    where: { isPrivate: false, ...visibleProjectsWhere(user) },
    orderBy: [{ position: "asc" }, { createdAt: "asc" }],
    select: { id: true, name: true, adminPicks: { where: { userId: user.id }, select: { userId: true } }, visits: { where: { userId: user.id }, select: { visitedAt: true } } },
  });
  // En el orden que ha elegido en su perfil (como el selector de la barra lateral).
  const ordered = sortProjects(projects.map((p) => ({ ...p, visitedAt: p.visits[0]?.visitedAt ?? null })), user.projectOrder, user.locale === "EN" ? "en" : "es");
  return <ExistingProjects userId={user.id} projects={ordered.map((p) => ({ id: p.id, name: p.name, picked: p.adminPicks.length > 0 }))} />;
}
