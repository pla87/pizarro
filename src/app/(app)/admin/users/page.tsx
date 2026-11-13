import { db } from "@/lib/db";
import { MAX_USERS } from "@/lib/limits";
import { googleEnabled } from "@/lib/google";
import { emailEnabled } from "@/lib/mail";
import { getInstanceSettings } from "@/lib/instance";
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
    select: {
      id: true, name: true, email: true, role: true, active: true, locale: true, mustChangePassword: true, twoFactorMethod: true, googleSub: true, googleRelinkBlocked: true,
      _count: { select: { sessions: true, knownDevices: true } },
    },
  });
  // De los proyectos privados en los que cada usuario es el único miembro solo se pasan los ids (los administradores no
  // ven sus nombres): al borrarlo pasan a ser de equipo, o se borran con él si se marca la casilla.
  const privates = await db.project.findMany({ where: { isPrivate: true }, select: { id: true, members: { select: { userId: true } } } });
  const sole = new Map<string, string[]>();
  for (const p of privates) if (p.members.length === 1) sole.set(p.members[0]!.userId, [...(sole.get(p.members[0]!.userId) ?? []), p.id]);
  const rows = users.map(({ twoFactorMethod, googleSub, _count, ...u }) => ({
    ...u,
    twoFactor: twoFactorMethod !== null,
    googleLinked: googleSub !== null,
    privateProjects: sole.get(u.id) ?? [],
    // Invitación pendiente: debe elegir contraseña y nunca ha entrado (cada acceso deja una sesión y un dispositivo conocido).
    invitePending: u.mustChangePassword && googleSub === null && _count.sessions === 0 && _count.knownDevices === 0,
  }));
  const { locale } = await getInstanceSettings();
  return <UsersAdmin users={rows} meId={me.id} maxUsers={MAX_USERS} emailAvailable={emailEnabled()} noRecovery={!emailEnabled() && !googleEnabled()} defaultLocale={locale === "en" ? "EN" : "ES"} />;
}
