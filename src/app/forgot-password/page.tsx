import { redirect } from "next/navigation";
import Link from "next/link";
import { AuthCard } from "@/components/auth/AuthCard";
import { googleEnabled } from "@/lib/google";
import { emailEnabled } from "@/lib/mail";
import { getCurrentUser } from "@/lib/session";
import { getT } from "@/i18n/server";
import { ForgotForm } from "./ForgotForm";

export async function generateMetadata() {
  const t = await getT();
  return { title: t("Recuperar contraseña") };
}

export default async function ForgotPasswordPage() {
  if (await getCurrentUser()) redirect("/");
  const t = await getT();
  if (!emailEnabled()) {
    // Sin email no hay enlace de recuperación: se explican las alternativas en vez de un 404.
    return (
      <AuthCard title={t("Recuperar contraseña")}>
        <div className="space-y-4 text-sm" data-testid="forgot-no-email">
          <p className="font-medium">{t("Este servidor no tiene configurado el envío de emails")}</p>
          <p>{t("Por eso no podemos enviarte un enlace para elegir una contraseña nueva. Estas son las opciones:")}</p>
          <ul className="list-disc space-y-2 pl-5">
            {googleEnabled() && <li>{t("Entra con tu cuenta de Google, si tu email está dado de alta.")}</li>}
            <li>{t("Pide a un administrador que te genere un enlace para elegir una contraseña nueva (Administración → Usuarios → Forzar cambio de contraseña). Te lo pasará por otro canal; sirve una sola vez y caduca en 30 minutos.")}</li>
            <li>{t("Si eres quien administra el servidor: la sección «Altas, bajas y contraseñas» del manual explica cómo recuperar el acceso, o configura el envío de emails (SMTP).")}</li>
          </ul>
          {googleEnabled() && <a href="/api/auth/google/start" className="btn-secondary w-full">{t("Iniciar sesión con Google")}</a>}
          <Link href="/login" className="btn-secondary w-full">{t("Volver a iniciar sesión")}</Link>
        </div>
      </AuthCard>
    );
  }
  return (
    <AuthCard title={t("Recuperar contraseña")}>
      <ForgotForm />
    </AuthCard>
  );
}
