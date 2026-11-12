import { AuthCard } from "@/components/auth/AuthCard";
import { findUsableToken } from "@/lib/auth-token";
import { emailEnabled } from "@/lib/mail";
import { getT } from "@/i18n/server";
import { ResetForm } from "./ResetForm";

export async function generateMetadata() {
  const t = await getT();
  return { title: t("Elige una contraseña nueva") };
}

// El enlace se comprueba al abrir la página, pero solo se gasta al enviar la contraseña.
export default async function ResetPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const t = await getT();
  const row = await findUsableToken(token, ["PASSWORD_RESET", "INVITE"]);
  if (!row) {
    return (
      <AuthCard title={t("Enlace no válido")}>
        <div className="space-y-4 text-sm">
          <p>{t("El enlace no es válido o ha caducado. Pide uno nuevo.")}</p>
          {/* Recarga completa: ver ResetForm (el idioma del layout no cambia en la navegación de cliente). */}
          <a href={emailEnabled() ? "/forgot-password" : "/login"} className="btn-primary w-full">
            {emailEnabled() ? t("Pedir un enlace nuevo") : t("Volver a iniciar sesión")}
          </a>
        </div>
      </AuthCard>
    );
  }
  return (
    <AuthCard title={row.purpose === "INVITE" ? t("Elige tu contraseña") : t("Elige una contraseña nueva")}>
      <ResetForm token={token} email={row.user.email} invite={row.purpose === "INVITE"} />
    </AuthCard>
  );
}
