import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { isSetupPending } from "@/lib/setup";
import { AuthCard } from "@/components/auth/AuthCard";
import { googleOnly, passwordFormVisible } from "@/lib/auth-policy";
import { googleEnabled } from "@/lib/google";
import { emailEnabled } from "@/lib/mail";
import { getCurrentUser, getPendingUser } from "@/lib/session";
import { getT } from "@/i18n/server";
import { LoginForm } from "./LoginForm";

export async function generateMetadata() {
  const t = await getT();
  return { title: t("Iniciar sesión") };
}

// Códigos fijos que deja /api/auth/google/*: nunca texto libre en la URL.
const ERRORS: Record<string, string> = {
  google_noaccount: "No hay ninguna cuenta con ese email de Google; pide a un administrador que te dé de alta.",
  google_unlinked: "Tu cuenta de Google está desvinculada. Entra con tu contraseña o pide a un administrador que la permita de nuevo.",
  google_domain: "Usa una cuenta de Google del dominio de la empresa.",
  google_unverified: "Google no ha verificado ese email.",
  google_state: "El inicio de sesión con Google ha caducado o no es válido. Vuelve a intentarlo.",
  google_cancelled: "Has cancelado el inicio de sesión con Google.",
  google_disabled: "El inicio de sesión con Google no está configurado en el servidor.",
  twofactor_locked: "Demasiados intentos. Vuelve a introducir tu contraseña.",
  twofactor_expired: "La verificación ha caducado. Vuelve a entrar.",
  rate: "Demasiados intentos. Espera unos minutos.",
  google_failed: "No se pudo iniciar sesión con Google. Inténtalo de nuevo.",
};

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  if (await getCurrentUser()) redirect("/");
  if (await getPendingUser()) redirect("/change-password");
  // Instalación nueva sin usuarios: el acceso no sirve de nada, se configura en el asistente.
  if (await isSetupPending(db)) redirect("/setup");
  const t = await getT();
  const { next, error } = await searchParams;
  const message = typeof error === "string" ? ERRORS[Object.hasOwn(ERRORS, error) ? error : "google_failed"]! : null;
  return (
    <AuthCard title={t("Iniciar sesión")}>
      <LoginForm
        next={typeof next === "string" ? next : ""}
        canReset={emailEnabled()}
        google={googleEnabled()}
        password={passwordFormVisible()}
        emergency={googleOnly()}
        notice={message ? t(message) : null}
      />
    </AuthCard>
  );
}
