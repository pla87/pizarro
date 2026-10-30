import { redirect } from "next/navigation";
import { AuthCard } from "@/components/auth/AuthCard";
import { googleOnly } from "@/lib/auth-policy";
import { googlePolicyEnv } from "@/lib/google-config";
import { getCurrentUser, getPendingUser } from "@/lib/session";
import { getT } from "@/i18n/server";
import { ChangePasswordForm } from "./ChangePasswordForm";

export async function generateMetadata() {
  const t = await getT();
  return { title: t("Elige una contraseña nueva") };
}

// Pantalla obligatoria tras un cambio forzado o un alta con clave inicial: hasta elegirla no se abre nada más.
export default async function ChangePasswordPage() {
  const user = await getPendingUser();
  if (!user) redirect((await getCurrentUser()) ? "/" : "/login");
  const t = await getT();
  return (
    <AuthCard title={t("Elige una contraseña nueva")}>
      <ChangePasswordForm email={user.email} googleOnly={googleOnly(googlePolicyEnv())} />
    </AuthCard>
  );
}
