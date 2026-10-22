import Link from "next/link";
import { AuthCard } from "@/components/auth/AuthCard";
import { findUsableToken } from "@/lib/auth-token";
import { getT } from "@/i18n/server";
import { ConfirmForm } from "./ConfirmForm";

export async function generateMetadata() {
  const t = await getT();
  return { title: t("Confirmar cambio") };
}

// Abrir el enlace no cambia nada (los gestores de correo lo precargan): hay que pulsar el botón.
export default async function ConfirmPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const t = await getT();
  const row = await findUsableToken(token, ["PASSWORD_CHANGE", "EMAIL_CHANGE"]);
  if (!row) {
    return (
      <AuthCard title={t("Enlace no válido")}>
        <div className="space-y-4 text-sm">
          <p>{t("El enlace no es válido o ha caducado. Repite el cambio desde tu perfil.")}</p>
          <Link href="/settings" className="btn-primary w-full">{t("Ir a mi perfil")}</Link>
        </div>
      </AuthCard>
    );
  }
  const newEmail = row.purpose === "EMAIL_CHANGE" && row.data && typeof row.data === "object" && "newEmail" in row.data ? String(row.data.newEmail) : null;
  return (
    <AuthCard title={row.purpose === "EMAIL_CHANGE" ? t("Confirmar el nuevo email") : t("Confirmar el cambio de contraseña")}>
      <ConfirmForm token={token} kind={row.purpose === "EMAIL_CHANGE" ? "EMAIL" : "PASSWORD"} newEmail={newEmail} />
    </AuthCard>
  );
}
