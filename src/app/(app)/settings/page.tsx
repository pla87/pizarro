import { userTemplates } from "@/lib/board";
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
  scope: { ok: false, text: "No se concedió el permiso de Google Drive. Vuelve a intentarlo y acepta el permiso." },
  domain: { ok: false, text: "Usa una cuenta de Google del dominio de la empresa." },
  token: { ok: false, text: "Google no devolvió un acceso permanente. Vuelve a conectar." },
};

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ google?: string }> }) {
  const user = await requireUserPage();
  const { google } = await searchParams;
  const row = await db.user.findUniqueOrThrow({
    where: { id: user.id },
    select: {
      name: true,
      email: true,
      cardStyle: true,
      notifyEmail: true,
      notifyWhatsapp: true,
      whatsappPhone: true,
      googleAccount: { select: { email: true } },
    },
  });
  const googleMessage = typeof google === "string" && Object.hasOwn(GOOGLE_MESSAGES, google) ? GOOGLE_MESSAGES[google]! : google ? GOOGLE_MESSAGES.error! : null;
  return (
    <ProfileSettings
      name={row.name}
      email={row.email}
      templates={await userTemplates(user.id)}
      cardStyle={row.cardStyle}
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
