import { cookies } from "next/headers";
import { getBackupAlert } from "@/lib/backup-alert";
import { listVisibleProjects, visibleProjectsWhere } from "@/lib/access";
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
    db.notification.count({ where: { userId: user.id, readAt: null, task: { project: visibleProjectsWhere(user) } } }),
    // Punto de aviso en «Administración» si la copia de seguridad está atrasada (solo se consulta a los admins).
    isAdmin ? getBackupAlert().then((a) => a?.active === true, () => false) : false,
    // Punto discreto si hay una versión nueva sin descartar (consulta cacheada 12 h; nunca falla).
    isAdmin ? getUpdateNotice().then((n) => n !== null) : false,
    // Recordatorio de licencia (solo admins, como mucho una vez al mes; nunca falla): a dónde lleva «Comprar».
    isAdmin
      ? licenseNudgeFor(user).then(async (show) => (show ? buyHref(await getPublicContactEmail().catch(() => ""), user.locale === "EN" ? "en" : "es") : null))
      : null,
  ]);
  const last = (await cookies()).get("tablon_last_project")?.value;
  const lastProjectId = projects.find((p) => p.id === last)?.id ?? null;
  return (
    <AppShell user={user} projects={projects.map((p) => ({ id: p.id, name: p.name, isPrivate: p.isPrivate }))} version={pkg.version} unread={unread} lastProjectId={lastProjectId} backupAlert={backupAlert} updateAvailable={updateAvailable} licenseNudge={licenseNudge}>
      {children}
    </AppShell>
  );
}
