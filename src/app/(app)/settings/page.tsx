import { db } from "@/lib/db";
import { googleEnabled } from "@/lib/google";
import { emailEnabled, whatsappEnabled } from "@/lib/notify";
import { requireUserPage } from "@/lib/session";
import { ProfileSettings } from "./ProfileSettings";

export const metadata = { title: "Mi perfil y plantillas" };

const GOOGLE_MESSAGES: Record<string, { ok: boolean; text: string }> = {
  connected: { ok: true, text: "Cuenta de Google conectada." },
  cancelled: { ok: false, text: "Has cancelado la conexión con Google." },
  state: { ok: false, text: "La conexión con Google ha caducado o no es válida. Vuelve a intentarlo." },
  disabled: { ok: false, text: "La integración con Google no está configurada en el servidor." },
  error: { ok: false, text: "No se pudo conectar con Google." },
};

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ google?: string }> }) {
  const user = await requireUserPage();
  const { google } = await searchParams;
  const row = await db.user.findUniqueOrThrow({
    where: { id: user.id },
    select: {
      name: true,
      email: true,
      releaseHeaderTemplate: true,
      releaseFooterTemplate: true,
      notifyEmail: true,
      notifyWhatsapp: true,
      whatsappPhone: true,
      googleAccount: { select: { email: true } },
    },
  });
  const googleMessage = google ? GOOGLE_MESSAGES[google] ?? { ok: false, text: google.slice(0, 200) } : null;
  return (
    <ProfileSettings
      name={row.name}
      email={row.email}
      header={row.releaseHeaderTemplate}
      footer={row.releaseFooterTemplate}
      notifications={{
        notifyEmail: row.notifyEmail,
        notifyWhatsapp: row.notifyWhatsapp,
        whatsappPhone: row.whatsappPhone ?? "",
        emailAvailable: emailEnabled(),
        whatsappAvailable: whatsappEnabled(),
      }}
      google={{ enabled: googleEnabled(), email: row.googleAccount?.email ?? null, message: googleMessage }}
    />
  );
}
