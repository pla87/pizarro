import { db } from "@/lib/db";
import { requireAdminPage } from "@/lib/session";
import { getT } from "@/i18n/server";
import { ProjectsAdmin } from "./ProjectsAdmin";

export async function generateMetadata() {
  const t = await getT();
  return { title: t("Proyectos") };
}

export default async function ProjectsAdminPage() {
  await requireAdminPage();
  // Los proyectos privados no se listan (ni siquiera su nombre).
  const [projects, users] = await Promise.all([
    db.project.findMany({
      where: { isPrivate: false },
      orderBy: [{ position: "asc" }, { createdAt: "asc" }],
      select: {
        id: true,
        name: true,
        members: { where: { user: { role: { not: "ADMIN" } } }, select: { userId: true } },
        adminPicks: { select: { userId: true } },
      },
    }),
    db.user.findMany({ where: { active: true }, orderBy: { name: "asc" }, select: { id: true, name: true, role: true } }),
  ]);
  return (
    <ProjectsAdmin
      users={users}
      projects={projects.map((p) => ({ id: p.id, name: p.name, memberIds: p.members.map((m) => m.userId), pickedAdminIds: p.adminPicks.map((a) => a.userId) }))}
    />
  );
}
