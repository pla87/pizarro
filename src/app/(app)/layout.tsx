import { cookies, headers } from "next/headers";
import { getBackupAlert } from "@/lib/backup-alert";
import { listVisibleProjects } from "@/lib/access";
import { visibleNotificationsWhere } from "@/lib/notification-access";
import { outsideListProject } from "@/lib/project-visit";
import { db } from "@/lib/db";
import { getPublicContactEmail } from "@/lib/google-config";
import { licenseNudgeFor } from "@/lib/license-registry";
import { buyHref } from "@/lib/product";
import { getUpdateNotice } from "@/lib/update-check";
import { requireUserPage } from "@/lib/session";
import { AppShell } from "@/components/AppShell";
import pkg from "../../../package.json";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUserPage();
  const isAdmin = user.role === "ADMIN";
  // En paralelo: estas consultas van en cada página.
  const [projects, unread, backupAlert, updateAvailable, licenseNudge] = await Promise.all([
    listVisibleProjects(user),
    db.notification.count({ where: { ...visibleNotificationsWhere(user), readAt: null } }),
    // Punto de aviso en «Administración» si la copia de seguridad está atrasada o es mucho menor que la última buena
    // (solo se consulta a los admins).
    isAdmin ? getBackupAlert().then((a) => (a?.active ? (a.reason === "shrunk" ? ("shrunk" as const) : true) : false), () => false) : false,
    // Punto discreto si hay una versión nueva sin descartar (consulta cacheada 12 h; nunca falla).
    isAdmin ? getUpdateNotice().then((n) => n !== null) : false,
    // Recordatorio de licencia (solo admins, como mucho una vez al mes; nunca falla): a dónde lleva «Comprar».
    isAdmin
      ? licenseNudgeFor(user).then(async (show) => (show ? buyHref(await getPublicContactEmail().catch(() => ""), user.locale === "EN" ? "en" : "es") : null))
      : null,
  ]);
  const last = (await cookies()).get("tablon_last_project")?.value;
  const lastProjectId = projects.find((p) => p.id === last)?.id ?? null;
  // Un administrador que abre (cargando la página) un proyecto de equipo que no está en su lista: el selector y la
  // navegación lo muestran desde el primer dibujo. Al llegar con la navegación de la app lo pide AppShell.
  const pathProject = isAdmin ? /^\/p\/([^/?#]+)/.exec((await headers()).get("x-pz-path") ?? "")?.[1] : undefined;
  const outside = pathProject && !projects.some((p) => p.id === pathProject) ? await outsideListProject(user, pathProject).catch(() => null) : null;
  return (
    <AppShell user={user} projects={projects.map((p) => ({ id: p.id, name: p.name, isPrivate: p.isPrivate }))} version={pkg.version} unread={unread} lastProjectId={lastProjectId} outsideProject={outside} backupAlert={backupAlert} updateAvailable={updateAvailable} licenseNudge={licenseNudge}>
      {children}
    </AppShell>
  );
}
