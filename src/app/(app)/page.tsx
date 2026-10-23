import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { FolderKanban } from "lucide-react";
import { listVisibleProjects } from "@/lib/access";
import { requireUserPage } from "@/lib/session";
import { getT } from "@/i18n/server";

export default async function Home() {
  const user = await requireUserPage();
  const t = await getT();
  const projects = await listVisibleProjects(user);
  const last = (await cookies()).get("tablon_last_project")?.value;
  const target = projects.find((p) => p.id === last) ?? projects[0];
  if (target) redirect(`/p/${target.id}`);
  // Un administrador sin proyectos elegidos puede tener proyectos de equipo a los que sí tiene acceso.
  const available = user.role === "ADMIN" ? (await listVisibleProjects(user, { all: true })).length : 0;
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center text-slate-500">
      <FolderKanban size={40} className="text-slate-300" />
      <p className="font-medium text-slate-700 dark:text-slate-300">{t("Todavía no tienes acceso a ningún proyecto.")}</p>
      {available > 0 && (
        <p className="text-sm">
          {t("Hay {n} proyecto(s) de equipo. Elige en cuáles trabajas en", { n: available })}{" "}
          <a href="/settings#proyectos" className="font-medium text-brand-600 underline dark:text-brand-300">{t("Mi perfil")}</a>.
        </p>
      )}
      <p className="text-sm">
        {user.role === "ADMIN" ? t("Crea uno desde el selector de proyectos del menú.") : t("Crea un proyecto privado desde el selector del menú o pide a un administrador que te dé acceso.")}
      </p>
    </div>
  );
}
