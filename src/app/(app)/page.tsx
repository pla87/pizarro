import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { FolderKanban } from "lucide-react";
import { listVisibleProjects } from "@/lib/access";
import { requireUserPage } from "@/lib/session";

export default async function Home() {
  const user = await requireUserPage();
  const projects = await listVisibleProjects(user);
  const last = (await cookies()).get("tablon_last_project")?.value;
  const target = projects.find((p) => p.id === last) ?? projects[0];
  if (target) redirect(`/p/${target.id}`);
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center text-slate-500">
      <FolderKanban size={40} className="text-slate-300" />
      <p className="font-medium text-slate-700 dark:text-slate-300">Todavía no tienes acceso a ningún proyecto.</p>
      <p className="text-sm">
        {user.role === "ADMIN" ? "Crea uno desde el selector de proyectos del menú." : "Pide a un administrador que te dé acceso."}
      </p>
    </div>
  );
}
