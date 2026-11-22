import { db } from "@/lib/db";
import { MAX_USERS, MAX_USERS_SOURCE } from "@/lib/limits";
import { googleEnabled } from "@/lib/google";
import { emailEnabled } from "@/lib/mail";
import { getInstanceSettings } from "@/lib/instance";
import { requireAdminPage } from "@/lib/session";
import { soloPrivateProjectIdsByUser } from "@/lib/user-delete";
import { invitePendingFrom } from "@/lib/user-entered";
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
  // De los proyectos privados en los que cada usuario es el único miembro activo solo se pasan los ids (los
  // administradores no ven sus nombres): al borrarlo pasan a ser de equipo, o se borran con él si se marca la casilla.
  const sole = await soloPrivateProjectIdsByUser();
  const rows = users.map(({ twoFactorMethod, googleSub, _count, ...u }) => ({
    ...u,
    twoFactor: twoFactorMethod !== null,
    googleLinked: googleSub !== null,
    privateProjects: sole.get(u.id) ?? [],
    // Invitación pendiente: debe elegir contraseña y nunca ha entrado (cada acceso deja una sesión y un dispositivo conocido).
    invitePending: invitePendingFrom({ mustChangePassword: u.mustChangePassword, googleSub, _count }),
  }));
  const { locale } = await getInstanceSettings();
  return <UsersAdmin users={rows} meId={me.id} maxUsers={MAX_USERS} maxUsersSource={MAX_USERS_SOURCE} emailAvailable={emailEnabled()} noRecovery={!emailEnabled() && !googleEnabled()} defaultLocale={locale === "en" ? "EN" : "ES"} />;
}
