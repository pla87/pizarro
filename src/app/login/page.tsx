import { redirect } from "next/navigation";
import { AuthCard } from "@/components/auth/AuthCard";
import { emailEnabled } from "@/lib/mail";
import { getCurrentUser, getPendingUser } from "@/lib/session";
import { getT } from "@/i18n/server";
import { LoginForm } from "./LoginForm";

export async function generateMetadata() {
  const t = await getT();
  return { title: t("Iniciar sesión") };
}

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  if (await getCurrentUser()) redirect("/");
  if (await getPendingUser()) redirect("/change-password");
  const t = await getT();
  const { next } = await searchParams;
  return (
    <AuthCard title={t("Iniciar sesión")}>
      <LoginForm next={typeof next === "string" ? next : ""} canReset={emailEnabled()} />
    </AuthCard>
  );
}
