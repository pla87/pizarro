import { cookies } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { FolderKanban } from "lucide-react";
import { listVisibleProjects } from "@/lib/access";
import { requireUserPage } from "@/lib/session";
import { getT } from "@/i18n/server";
import { NewProjectButton } from "@/components/AppShell";

export default async function Home() {
  const user = await requireUserPage();
  const t = await getT();
  const projects = await listVisibleProjects(user);
  const last = (await cookies()).get("tablon_last_project")?.value;
  const target = projects.find((p) => p.id === last) ?? projects[0];
  if (target) redirect(`/p/${target.id}`);
  // Un administrador sin proyectos elegidos puede tener proyectos de equipo a los que sí tiene acceso.
  const available = user.role === "ADMIN" ? (await listVisibleProjects(user, { all: true })).length : 0;
  // Instalación recién estrenada (o sin ningún proyecto que pueda ver): el administrador lo crea desde aquí mismo.
  if (user.role === "ADMIN" && available === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center text-slate-500">
        <FolderKanban size={40} className="text-slate-300" />
        <p className="font-medium text-slate-700 dark:text-slate-300">{t("Aún no hay proyectos.")}</p>
        <NewProjectButton isAdmin />
      </div>
    );
  }
  // Administrador con la lista vacía pero con proyectos de equipo que no ha añadido a sus proyectos: sí tiene acceso
  // (antes decía «Todavía no tienes acceso a ningún proyecto» y no ofrecía crear uno aquí).
  if (user.role === "ADMIN") {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center text-slate-500" data-testid="home-empty-admin">
        <FolderKanban size={40} className="text-slate-300" />
        <p className="font-medium text-slate-700 dark:text-slate-300">{t("Tu lista de proyectos está vacía.")}</p>
        <p className="text-sm">
          {available === 1 ? t("Hay 1 proyecto de equipo que no está en tu lista.") : t("Hay {n} proyectos de equipo que no están en tu lista.", { n: available })}{" "}
          <Link href="/projects" className="font-medium text-brand-600 underline dark:text-brand-300">{t("Ver proyectos existentes")}</Link>
        </p>
        <p className="max-w-md text-sm">{t("Añade a tus proyectos los que quieras ver en selectores, menús y calendario.")}</p>
        <NewProjectButton isAdmin />
      </div>
    );
  }
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center text-slate-500">
      <FolderKanban size={40} className="text-slate-300" />
      <p className="font-medium text-slate-700 dark:text-slate-300">{t("Todavía no tienes acceso a ningún proyecto.")}</p>
      {/* Quien no es administrador puede crear sus proyectos privados: el mismo botón que el del administrador, aquí mismo. */}
      <p className="text-sm">{t("Crea un proyecto privado o pide a un administrador que te dé acceso.")}</p>
      <NewProjectButton isAdmin={false} />
    </div>
  );
}
