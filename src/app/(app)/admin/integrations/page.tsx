import { headers } from "next/headers";
import { getMailSettingsView } from "@/lib/mail-config";
import { getGoogleSettingsView } from "@/lib/google-config";
import { originFromHeaders } from "@/lib/google-config-core";
import { outboxDir } from "@/lib/mail";
import { requireAdminPage } from "@/lib/session";
import { getT } from "@/i18n/server";
import { getMessagingAdminView } from "@/lib/messaging";
import { MailSettingsSection } from "./MailSettingsSection";
import { GoogleSettingsSection } from "./GoogleSettingsSection";
import { MessagingSettingsSection } from "./MessagingSettingsSection";

export async function generateMetadata() {
  const t = await getT();
  return { title: t("Integraciones") };
}

/**
 * Administración → Integraciones: los servicios externos con credenciales (1. email/SMTP, 2. acceso con Google y Google
 * Docs, 3. Telegram y WhatsApp). Antes iban en Ajustes; los enlaces antiguos con ancla (/admin/settings#avisos-email,
 * #acceso-google, #mensajeria) llegan aquí con MovedSectionRedirect.
 */
export default async function IntegrationsPage() {
  await requireAdminPage();
  // Dirección con la que entra el administrador ahora (para avisar si no coincide con APP_URL).
  const h = await headers();
  const origin = originFromHeaders({ host: h.get("host"), forwardedHost: h.get("x-forwarded-host"), forwardedProto: h.get("x-forwarded-proto") });
  const [mail, google, messaging] = await Promise.all([getMailSettingsView(Boolean(outboxDir())), getGoogleSettingsView(origin), getMessagingAdminView()]);
  return (
    <div className="space-y-4">
      <MailSettingsSection initial={mail.settings} env={mail.env} outbox={mail.outbox} />
      <GoogleSettingsSection view={google} />
      <MessagingSettingsSection view={messaging} />
    </div>
  );
}
