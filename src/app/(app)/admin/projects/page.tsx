import { db } from "@/lib/db";
import { requireAdminPage } from "@/lib/session";
import { getT } from "@/i18n/server";
import { invitePendingFrom } from "@/lib/user-entered";
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
        members: { select: { userId: true } },
        adminPicks: { select: { userId: true } },
      },
    }),
    db.user.findMany({
      where: { active: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true, role: true, mustChangePassword: true, googleSub: true, _count: { select: { sessions: true, knownDevices: true } } },
    }),
  ]);
  return (
    <ProjectsAdmin
      // «Invitación pendiente» (el criterio de Administración → Usuarios), para marcarla entre los asignados.
      users={users.map((u) => ({ id: u.id, name: u.name, role: u.role, invitePending: invitePendingFrom(u) }))}
      projects={projects.map((p) => ({ id: p.id, name: p.name, memberIds: p.members.map((m) => m.userId), pickedAdminIds: p.adminPicks.map((a) => a.userId) }))}
    />
  );
}
