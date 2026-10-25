import { backupKeyState, listBackups, readStatus } from "@/lib/backup";
import { getBackupAlert } from "@/lib/backup-alert";
import { db } from "@/lib/db";
import { listJobRuns } from "@/lib/jobs";
import { MAINTENANCE_JOBS } from "@/lib/maintenance";
import { requireAdminPage } from "@/lib/session";
import { getT } from "@/i18n/server";
import { BackupsAdmin } from "./BackupsAdmin";

export async function generateMetadata() {
  const t = await getT();
  return { title: t("Copias de seguridad") };
}

export default async function BackupsPage() {
  const user = await requireAdminPage();
  const [status, files, alert, me, jobs] = await Promise.all([readStatus(), listBackups(), getBackupAlert(), db.user.findUnique({ where: { id: user.id }, select: { twoFactorMethod: true } }), listJobRuns()]);
  // Tareas en el orden en que se ejecutan (las desconocidas, al final).
  const rank = (name: string) => {
    const i = MAINTENANCE_JOBS.findIndex((j) => j.name === name);
    return i < 0 ? MAINTENANCE_JOBS.length : i;
  };
  jobs.sort((a, b) => rank(a.name) - rank(b.name));
  // Quien entra con Google y no conoce su contraseña puede confirmar la descarga con un código de su app (TOTP).
  return <BackupsAdmin keyState={backupKeyState()} alert={alert} status={status} files={files} canUseCode={me?.twoFactorMethod === "TOTP"} jobs={jobs} />;
}
