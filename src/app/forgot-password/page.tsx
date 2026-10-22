import { notFound, redirect } from "next/navigation";
import { AuthCard } from "@/components/auth/AuthCard";
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
  if (!emailEnabled()) notFound();
  const t = await getT();
  return (
    <AuthCard title={t("Recuperar contraseña")}>
      <ForgotForm />
    </AuthCard>
  );
}
