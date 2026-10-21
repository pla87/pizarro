import { redirect } from "next/navigation";
import { BrandMark } from "@/components/ui/BrandMark";
import { getCurrentUser } from "@/lib/session";
import { getT } from "@/i18n/server";
import { LoginForm } from "./LoginForm";

export async function generateMetadata() {
  const t = await getT();
  return { title: t("Iniciar sesión") };
}

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  if (await getCurrentUser()) redirect("/");
  const t = await getT();
  const { next } = await searchParams;
  return (
    <main className="flex min-h-dvh items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center justify-center gap-2">
          <BrandMark size={36} />
          <span className="text-2xl font-bold tracking-tight">Pizarro</span>
        </div>
        <div className="card p-6">
          <h1 className="mb-4 text-lg font-semibold">{t("Iniciar sesión")}</h1>
          <LoginForm next={typeof next === "string" ? next : ""} />
        </div>
      </div>
    </main>
  );
}
