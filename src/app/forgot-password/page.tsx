import { redirect } from "next/navigation";
import Link from "next/link";
import { AuthCard } from "@/components/auth/AuthCard";
import { googleEnabled } from "@/lib/google";
import { emailEnabled } from "@/lib/mail";
import { getCurrentUser } from "@/lib/session";
import { getLocale, getT } from "@/i18n/server";
import { installSectionUrl } from "@/lib/product";
import { setupCodeSource, type SetupCodeSource } from "@/lib/setup-core";
import { ForgotForm } from "./ForgotForm";

export async function generateMetadata() {
  const t = await getT();
  return { title: t("Recuperar contraseña") };
}

const code = (cmd: string) => <code className="break-all rounded bg-slate-100 px-1 py-0.5 font-mono text-xs dark:bg-slate-800">{cmd}</code>;
const DOCKER_CMD = "cd /opt/pizarro/deploy && docker compose exec app node dist/reset-link.mjs <email>";

/**
 * Cómo genera el enlace quien administra el servidor, solo con la orden de su instalación (la misma detección que el
 * paso 1 de /setup, setupCodeSource): Docker, `npm start`, Railway (en la pestaña Console del servicio, en la web),
 * Render (pestaña Shell) o Fly.io (`fly ssh console`); en esas dos, con la ruta completa, por si la consola no empieza en /app;
 * si no se sabe, la de Docker y la de Railway, como antes.
 */
function resetLinkHint(source: SetupCodeSource, t: Awaited<ReturnType<typeof getT>>) {
  switch (source) {
    case "railway":
      return <>{t("Si eres quien administra el servidor, genera el enlace en la pestaña Console del servicio de Pizarro en Railway:")} {code("node dist/reset-link.mjs <email>")}.</>;
    case "render":
      return <>{t("Si eres quien administra el servidor, genera el enlace en la pestaña Shell del servicio de Pizarro en Render:")} {code("node /app/dist/reset-link.mjs <email>")}.</>;
    case "fly":
      return <>{t("Si eres quien administra el servidor, genera el enlace desde tu terminal con flyctl:")} {code('fly ssh console -C "node /app/dist/reset-link.mjs <email>"')}.</>;
    case "npm":
      return <>{t("Si eres quien administra el servidor, genera el enlace desde una terminal en la carpeta de Pizarro:")} {code("node --env-file=.env dist/reset-link.mjs <email>")}.</>;
    case "docker":
      return <>{t("Si eres quien administra el servidor, genera el enlace desde su terminal:")} {code(DOCKER_CMD)}.</>;
    default:
      return (
        <>
          {t("Si eres quien administra el servidor, genera el enlace desde su terminal:")} {code(DOCKER_CMD)}{" "}
          {t("(en Railway, en la pestaña Console del servicio de Pizarro:")} {code("node dist/reset-link.mjs <email>")}).
        </>
      );
  }
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
              {resetLinkHint(setupCodeSource(), t)} {t("También puedes configurar el envío de emails (SMTP).")}{" "}
              <a href={installSectionUrl("lockedOut", locale)} target="_blank" rel="noopener noreferrer" className="font-medium text-brand-700 underline dark:text-brand-300">{t("Guía de instalación")}</a>
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
