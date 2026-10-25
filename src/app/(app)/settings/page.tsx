import { visibleProjectsWhere } from "@/lib/access";
import { userTemplates } from "@/lib/board";
import { db } from "@/lib/db";
import { googleEnabled } from "@/lib/google";
import { appTimeZone } from "@/lib/board";
import { emailEnabled, whatsappEnabled } from "@/lib/notify";
import { NotificationExtras } from "./NotificationExtras";
import { currentSessionId, requireUserPage } from "@/lib/session";
import { recoveryCodesLeft } from "@/lib/two-factor";
import { deviceLabel } from "@/lib/user-agent";
import { getT } from "@/i18n/server";
import { EmailChangeSection } from "./EmailChangeSection";
import { ProfileSettings } from "./ProfileSettings";
import { ProjectPicksSection } from "./ProjectPicksSection";
import { SessionsSection } from "./SessionsSection";
import { TwoFactorSection } from "./TwoFactorSection";

export async function generateMetadata() {
  const t = await getT();
  return { title: t("Mi perfil") };
}

const GOOGLE_MESSAGES: Record<string, { ok: boolean; text: string }> = {
  connected: { ok: true, text: "Cuenta de Google conectada." },
  cancelled: { ok: false, text: "Has cancelado la conexión con Google." },
  state: { ok: false, text: "La conexión con Google ha caducado o no es válida. Vuelve a intentarlo." },
  disabled: { ok: false, text: "La integración con Google no está configurada en el servidor." },
  error: { ok: false, text: "No se pudo conectar con Google." },
  scope: { ok: false, text: "No se concedió el permiso de Google Drive. Vuelve a intentarlo y acepta el permiso." },
  domain: { ok: false, text: "Usa una cuenta de Google del dominio de la empresa." },
  token: { ok: false, text: "Google no devolvió un acceso permanente. Vuelve a conectar." },
  identity: { ok: false, text: "Google no confirmó la identidad de la cuenta. Vuelve a intentarlo." },
};

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ google?: string }> }) {
  const user = await requireUserPage();
  const t = await getT();
  const { google } = await searchParams;
  const row = await db.user.findUniqueOrThrow({
    where: { id: user.id },
    select: {
      name: true,
      email: true,
      cardStyle: true,
      editorMode: true,
      clearDraftsOnLogout: true,
      theme: true,
      accent: true,
      locale: true,
      notifyEmail: true,
      notifyWhatsapp: true,
      whatsappPhone: true,
      twoFactorMethod: true,
      notifyAssignedEmail: true,
      notifyDueEmail: true,
      notifyCommentEmail: true,
      dailyDigest: true,
      digestHour: true,
      googleAccount: { select: { email: true } },
    },
  });
  const codesLeft = row.twoFactorMethod ? await recoveryCodesLeft(user.id) : 0;
  const [sessions, currentId] = await Promise.all([
    db.session.findMany({
      where: { userId: user.id, expiresAt: { gt: new Date() } },
      orderBy: { lastSeenAt: "desc" },
      select: { id: true, userAgent: true, ip: true, lastSeenAt: true, createdAt: true },
    }),
    currentSessionId(),
  ]);
  // Administradores: todos los proyectos de equipo y sus privados, con los que han elegido para trabajar.
  const pickProjects = user.role === "ADMIN"
    ? await db.project.findMany({
        where: visibleProjectsWhere(user),
        orderBy: [{ position: "asc" }, { createdAt: "asc" }],
        select: { id: true, name: true, isPrivate: true, adminPicks: { where: { userId: user.id }, select: { userId: true } } },
      })
    : [];
  let googleMessage = typeof google === "string" && Object.hasOwn(GOOGLE_MESSAGES, google) ? GOOGLE_MESSAGES[google]! : google ? GOOGLE_MESSAGES.error! : null;
  if (googleMessage) googleMessage = { ...googleMessage, text: t(googleMessage.text) };
  return (
    <>
      <ProfileSettings
        name={row.name}
        email={row.email}
        templates={await userTemplates(user.id)}
        cardStyle={row.cardStyle}
        editorMode={row.editorMode}
        clearDraftsOnLogout={row.clearDraftsOnLogout}
        theme={row.theme}
        accent={row.accent}
        locale={row.locale}
        notifications={{
          notifyEmail: row.notifyEmail,
          notifyWhatsapp: row.notifyWhatsapp,
          whatsappPhone: row.whatsappPhone ?? "",
          emailAvailable: emailEnabled(),
          whatsappAvailable: whatsappEnabled(),
        }}
        notificationExtras={
          <NotificationExtras
            prefs={{ notifyAssignedEmail: row.notifyAssignedEmail, notifyDueEmail: row.notifyDueEmail, notifyCommentEmail: row.notifyCommentEmail, dailyDigest: row.dailyDigest, digestHour: row.digestHour }}
            emailAvailable={emailEnabled()}
            timeZone={appTimeZone()}
          />
        }
        google={{ enabled: googleEnabled(), email: row.googleAccount?.email ?? null, message: googleMessage }}
      />
      <div className="mx-auto max-w-3xl space-y-5 px-4 pb-6 md:px-6">
        {user.role === "ADMIN" && <ProjectPicksSection projects={pickProjects.map((p) => ({ id: p.id, name: p.name, isPrivate: p.isPrivate, picked: p.adminPicks.length > 0 }))} />}
        {emailEnabled() && <EmailChangeSection email={row.email} />}
        <TwoFactorSection method={row.twoFactorMethod} admin={user.role === "ADMIN"} emailAvailable={emailEnabled()} codesLeft={codesLeft} />
        <SessionsSection
          sessions={sessions.map((s) => ({
            id: s.id,
            device: deviceLabel(s.userAgent, t),
            ip: s.ip,
            lastSeenAt: s.lastSeenAt.toISOString(),
            createdAt: s.createdAt.toISOString(),
            current: s.id === currentId,
          }))}
        />
      </div>
    </>
  );
}
