import { cookies, headers } from "next/headers";
import { getBackupAlert } from "@/lib/backup-alert";
import { lowDiskSpace } from "@/lib/health";
import { uploadDir } from "@/lib/upload-dir";
import { listVisibleProjects } from "@/lib/access";
import { unreadCount } from "@/lib/notification-access";
import { outsideListProject } from "@/lib/project-visit";
import { getPublicContactEmail } from "@/lib/google-config";
import { licenseNudgeFor } from "@/lib/license-registry";
import { buyHref } from "@/lib/product";
import { releaseUse } from "@/lib/release-nav";
import { getUpdateNotice } from "@/lib/update-check";
import { getFeedbackStatus } from "@/lib/feedback";
import { requireUserPage } from "@/lib/session";
import { AppShell } from "@/components/AppShell";
import pkg from "../../../package.json";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUserPage();
  const isAdmin = user.role === "ADMIN";
  const anyPathProject = /^\/p\/([^/?#]+)/.exec((await headers()).get("x-pz-path") ?? "")?.[1];
  // «Releases» del menú solo en proyectos que las usan: se pide ya, en paralelo con lo demás (y la página del tablero
  // reutiliza la misma respuesta, `cache`); solo se usa si el proyecto está en la lista de la persona.
  const releaseUsePromise = anyPathProject ? releaseUse(anyPathProject).catch(() => null) : null;
  // En paralelo: estas consultas van en cada página.
  const [projects, unread, backupAlert, updateAvailable, diskLow, licenseNudge, feedback] = await Promise.all([
    listVisibleProjects(user),
    // Con tope: la interfaz muestra «99+» a partir de 100, así que no hace falta contar más allá (AppShell).
    unreadCount(user.id, user.role),
    // Punto de aviso en «Administración» si la copia de seguridad está atrasada o es mucho menor que la última buena
    // (solo se consulta a los admins).
    isAdmin ? getBackupAlert().then((a) => (a?.active ? (a.reason === "shrunk" ? ("shrunk" as const) : true) : false), () => false) : false,
    // Punto discreto si hay una versión nueva sin descartar (consulta cacheada 12 h; nunca falla).
    isAdmin ? getUpdateNotice().then((n) => n !== null) : false,
    // Punto si el disco de las subidas está casi lleno (un statfs; /api/health ya no da 503 por esto).
    isAdmin ? lowDiskSpace(uploadDir()).then((d) => d !== null) : false,
    // Recordatorio de licencia (solo admins, como mucho una vez al mes; nunca falla): a dónde lleva «Comprar».
    isAdmin
      ? licenseNudgeFor(user).then(async (show) => (show ? buyHref(await getPublicContactEmail().catch(() => ""), user.locale === "EN" ? "en" : "es") : null))
      : null,
    // «Informar de un error o enviar una sugerencia» (para todos, solo en builds oficiales; nunca falla ni espera a GitHub).
    getFeedbackStatus().catch(() => null),
  ]);
  const last = (await cookies()).get("tablon_last_project")?.value;
  const lastProjectId = projects.find((p) => p.id === last)?.id ?? null;
  // Un administrador que abre (cargando la página) un proyecto de equipo que no está en su lista: el selector y la
  // navegación lo muestran desde el primer dibujo. Al llegar con la navegación de la app lo pide AppShell.
  const pathProject = isAdmin ? anyPathProject : undefined;
  const outside = pathProject && !projects.some((p) => p.id === pathProject) ? await outsideListProject(user, pathProject).catch(() => null) : null;
  // El tablero lo corrige después con sus columnas en vivo (releaseNav.ts).
  const use = anyPathProject && projects.some((p) => p.id === anyPathProject) ? await releaseUsePromise : null;
  const releaseNav = use && anyPathProject ? { id: anyPathProject, show: use.column || use.release } : null;
  return (
    <AppShell user={user} projects={projects.map((p) => ({ id: p.id, name: p.name, isPrivate: p.isPrivate }))} version={pkg.version} unread={unread} lastProjectId={lastProjectId} outsideProject={outside} releaseNav={releaseNav} backupAlert={backupAlert} updateAvailable={updateAvailable} diskLow={diskLow} licenseNudge={licenseNudge} feedback={feedback}>
      {children}
    </AppShell>
  );
}
