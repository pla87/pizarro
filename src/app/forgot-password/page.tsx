import { redirect } from "next/navigation";
import Link from "next/link";
import { AuthCard } from "@/components/auth/AuthCard";
import { googleEnabled } from "@/lib/google";
import { emailEnabled } from "@/lib/mail";
import { getCurrentUser } from "@/lib/session";
import { getLocale, getT } from "@/i18n/server";
import { installSectionUrl } from "@/lib/product";
import { ForgotForm } from "./ForgotForm";

export async function generateMetadata() {
  const t = await getT();
  return { title: t("Recuperar contraseña") };
}

export default async function ForgotPasswordPage() {
  if (await getCurrentUser()) redirect("/");
  const t = await getT();
  const locale = await getLocale();
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
            <li>
              {t("Si eres quien administra el servidor, genera el enlace desde su terminal:")}{" "}
              <code className="break-all rounded bg-slate-100 px-1 py-0.5 font-mono text-xs dark:bg-slate-800">docker compose exec app node dist/reset-link.mjs &lt;email&gt;</code>{" "}
              {t("(en Railway, en la terminal del servicio). También puedes configurar el envío de emails (SMTP).")}{" "}
              <a href={installSectionUrl("troubleshooting", locale)} target="_blank" rel="noopener noreferrer" className="font-medium text-brand-700 underline dark:text-brand-300">{t("Guía de instalación")}</a>
            </li>
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
