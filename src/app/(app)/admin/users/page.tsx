import { db } from "@/lib/db";
import { MAX_USERS } from "@/lib/limits";
import { requireAdminPage } from "@/lib/session";
import { getT } from "@/i18n/server";
import { UsersAdmin } from "./UsersAdmin";

export async function generateMetadata() {
  const t = await getT();
  return { title: t("Usuarios") };
}

export default async function UsersPage() {
  const me = await requireAdminPage();
  const users = await db.user.findMany({
    orderBy: [{ active: "desc" }, { name: "asc" }],
    select: { id: true, name: true, email: true, role: true, active: true, _count: { select: { privateProjects: true } } },
  });
  // De los proyectos privados ajenos solo se muestra cuántos hay (para avisar antes de borrar al usuario).
  const rows = users.map(({ _count, ...u }) => ({ ...u, privateProjects: _count.privateProjects }));
  return <UsersAdmin users={rows} meId={me.id} maxUsers={MAX_USERS} />;
}
