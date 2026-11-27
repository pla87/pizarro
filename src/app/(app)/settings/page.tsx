import { visibleProjectsWhere } from "@/lib/access";
import { sortProjects } from "@/lib/project-order";
import { userTemplates } from "@/lib/board";
import { userPlanTemplates } from "@/lib/ai-plan-templates";
import { db } from "@/lib/db";
import { googleEnabled } from "@/lib/google";
import { appTimeZone } from "@/lib/board";
import { emailEnabled } from "@/lib/notify";
import { getMyChannels } from "@/lib/messaging";
import { MessagingSection } from "./MessagingSection";
import { EmailNoticesSection } from "./EmailNoticesSection";
import { currentSessionId, requireUserPage } from "@/lib/session";
import { recoveryCodesLeft } from "@/lib/two-factor";
import { deviceLabel } from "@/lib/user-agent";
import { getT } from "@/i18n/server";
import { EmailChangeSection } from "./EmailChangeSection";
import { ProfileSettings } from "./ProfileSettings";
import { resolveProfileTab } from "./profile-tabs";
import { CanonicalTabParam } from "@/components/CanonicalTabParam";
import { ProjectPicksSection } from "./ProjectPicksSection";
import { SessionsSection } from "./SessionsSection";
import { TwoFactorSection } from "./TwoFactorSection";
import { DeleteAccountSection } from "./DeleteAccountSection";
import { deletionBlock, soloPrivateProjects } from "@/lib/user-delete";
import { deleteAlternatives } from "@/lib/user-delete-core";
import { passwordLoginAllowed } from "@/lib/auth-policy";
import { googlePolicyEnv } from "@/lib/google-config";
import { parseGoogleReauthResult } from "@/lib/google-reauth";
import { accountDeleteGoogleConfirmed } from "@/lib/two-factor";

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

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ google?: string; tab?: string; delete?: string }> }) {
  const user = await requireUserPage();
  const t = await getT();
  const { google, tab: tabParam, delete: deleteParam } = await searchParams;
  // El aviso de vuelta de Google se muestra en «Cuenta», donde está esa sección.
  const asked = resolveProfileTab(tabParam);
  // Otro nombre de una pestaña («?tab=account», «?tab=Notificaciones»): se pinta la suya y el cliente pasa la dirección a su
  // id (el de los enlaces de las pestañas) conservando el resto y el ancla, que un redirect del servidor perdía.
  const canonicalTab = !google && asked.kind === "alias" ? asked.tab : null;
  const tab = google ? "cuenta" : asked.tab;
  const row = await db.user.findUniqueOrThrow({
    where: { id: user.id },
    select: {
      name: true,
      email: true,
      cardStyle: true,
      editorMode: true,
      projectOrder: true,
      clearDraftsOnLogout: true,
      theme: true,
      accent: true,
      locale: true,
      notifyEmail: true,
      twoFactorMethod: true,
      notifyAssignedEmail: true,
      notifyDueEmail: true,
      notifyCommentEmail: true,
      dailyDigest: true,
      digestHour: true,
      googleAccount: { select: { email: true } },
      googleSub: true,
    },
  });
  // Solo lo de la pestaña que se pinta (las pestañas se cambian en el servidor), y todo a la vez.
  const account = tab === "cuenta";
  const noTemplates = { headers: [], footers: [] };
  const [codesLeft, sessions, currentId, pickProjects, templates, planTemplates, channels, block, privateProjects] = await Promise.all([
    account && row.twoFactorMethod ? recoveryCodesLeft(user.id) : 0,
    account
      ? db.session.findMany({
          where: { userId: user.id, expiresAt: { gt: new Date() } },
          orderBy: { lastSeenAt: "desc" },
          select: { id: true, userAgent: true, ip: true, lastSeenAt: true, createdAt: true },
        })
      : [],
    account ? currentSessionId() : null,
    // Administradores: todos los proyectos de equipo y sus privados, con los que han elegido para trabajar.
    user.role === "ADMIN" && tab === "preferencias"
      ? db.project.findMany({
          where: visibleProjectsWhere(user),
          orderBy: [{ position: "asc" }, { createdAt: "asc" }],
          select: { id: true, name: true, isPrivate: true, adminPicks: { where: { userId: user.id }, select: { userId: true } }, visits: { where: { userId: user.id }, select: { visitedAt: true } } },
        }).then((rows) => sortProjects(rows.map((p) => ({ ...p, visitedAt: p.visits[0]?.visitedAt ?? null })), row.projectOrder, user.locale === "EN" ? "en" : "es"))
      : [],
    tab === "plantillas" ? userTemplates(user.id) : noTemplates,
    tab === "plantillas" ? userPlanTemplates(user.id) : noTemplates,
    tab === "avisos" ? getMyChannels(user.id) : null,
    account ? deletionBlock(user.id) : null,
    account ? soloPrivateProjects(user.id) : null,
  ]);
  const googleConfirmed = account ? await accountDeleteGoogleConfirmed(user.id, currentId) : false;
  let googleMessage = typeof google === "string" && Object.hasOwn(GOOGLE_MESSAGES, google) ? GOOGLE_MESSAGES[google]! : google ? GOOGLE_MESSAGES.error! : null;
  if (googleMessage) googleMessage = { ...googleMessage, text: t(googleMessage.text) };
  return (
    <>
      {canonicalTab && <CanonicalTabParam tab={canonicalTab} />}
      <ProfileSettings
        name={row.name}
        email={row.email}
        templates={templates}
        planTemplates={planTemplates}
        cardStyle={row.cardStyle}
        editorMode={row.editorMode}
        projectOrder={row.projectOrder}
        clearDraftsOnLogout={row.clearDraftsOnLogout}
        theme={row.theme}
        accent={row.accent}
        locale={row.locale}
        notifications={{ emailAvailable: emailEnabled() }}
        notificationExtras={
          tab === "avisos" ? (
            <>
              <EmailNoticesSection
                prefs={{
                  notifyEmail: row.notifyEmail, notifyAssignedEmail: row.notifyAssignedEmail, notifyDueEmail: row.notifyDueEmail,
                  notifyCommentEmail: row.notifyCommentEmail, dailyDigest: row.dailyDigest, digestHour: row.digestHour,
                }}
                emailAvailable={emailEnabled()}
                adminNotices={user.role === "ADMIN"}
                timeZone={appTimeZone()}
              />
              {channels && <MessagingSection initial={channels} />}
            </>
          ) : null
        }
        tab={tab}
        unknownTab={!google && asked.kind === "unknown" ? asked.asked : undefined}
        preferencesExtra={
          user.role === "ADMIN" ? <ProjectPicksSection projects={pickProjects.map((p) => ({ id: p.id, name: p.name, isPrivate: p.isPrivate, picked: p.adminPicks.length > 0 }))} /> : null
        }
        accountExtra={
          account && <>
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
          </>
        }
        google={{ enabled: googleEnabled(), email: row.googleAccount?.email ?? null, message: googleMessage }}
        accountEnd={
          tab === "cuenta" ? (
            <DeleteAccountSection
              block={block!}
              privateProjects={privateProjects!}
              twoFactor={row.twoFactorMethod}
              emailAvailable={emailEnabled()}
              passwordLogin={passwordLoginAllowed(user.role, googlePolicyEnv())}
              alternatives={deleteAlternatives({ googleLinked: row.googleSub !== null, passwordLogin: passwordLoginAllowed(user.role, googlePolicyEnv()), twoFactor: row.twoFactorMethod, emailAvailable: emailEnabled(), googleAvailable: googleEnabled() })}
              googleConfirmed={googleConfirmed}
              reauth={parseGoogleReauthResult(deleteParam)}
            />
          ) : null
        }
      />
    </>
  );
}
