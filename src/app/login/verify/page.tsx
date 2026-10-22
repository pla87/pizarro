import { redirect } from "next/navigation";
import { AuthCard } from "@/components/auth/AuthCard";
import { getCurrentUser } from "@/lib/session";
import { readChallenge } from "@/lib/two-factor";
import { emailEnabled } from "@/lib/mail";
import { getT } from "@/i18n/server";
import { SetupForm } from "./SetupForm";
import { VerifyForm } from "./VerifyForm";

export async function generateMetadata() {
  const t = await getT();
  return { title: t("Verificación en dos pasos") };
}

// Segundo paso del acceso con contraseña. Solo se llega con el estado pendiente de la cookie pz_2fa: no hay sesión todavía.
export default async function VerifyPage() {
  if (await getCurrentUser()) redirect("/");
  const ch = await readChallenge();
  if (!ch) redirect("/login");
  const t = await getT();
  if (ch.kind === "SETUP") {
    return (
      <AuthCard title={t("Configura la verificación en dos pasos")}>
        <SetupForm emailAvailable={emailEnabled()} confirmed={ch.confirmed} />
      </AuthCard>
    );
  }
  return (
    <AuthCard title={t("Verificación en dos pasos")}>
      <VerifyForm method={ch.user.twoFactorMethod === "EMAIL" ? "EMAIL" : "TOTP"} emailSent={Boolean(ch.codeHash)} />
    </AuthCard>
  );
}
