import { db } from "@/lib/db";
import { MAX_USERS } from "@/lib/limits";
import { emailEnabled } from "@/lib/mail";
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
    select: { id: true, name: true, email: true, role: true, active: true, mustChangePassword: true, twoFactorMethod: true, googleSub: true, googleRelinkBlocked: true },
  });
  // De los proyectos privados solo se muestra cuántos tiene cada usuario como único miembro (se borrarían con él).
  const privates = await db.project.findMany({ where: { isPrivate: true }, select: { members: { select: { userId: true } } } });
  const sole = new Map<string, number>();
  for (const p of privates) if (p.members.length === 1) sole.set(p.members[0]!.userId, (sole.get(p.members[0]!.userId) ?? 0) + 1);
  const rows = users.map(({ twoFactorMethod, googleSub, ...u }) => ({ ...u, twoFactor: twoFactorMethod !== null, googleLinked: googleSub !== null, privateProjects: sole.get(u.id) ?? 0 }));
  return <UsersAdmin users={rows} meId={me.id} maxUsers={MAX_USERS} emailAvailable={emailEnabled()} />;
}
