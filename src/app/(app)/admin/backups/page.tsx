import { backupKeyState, listBackups, readStatus } from "@/lib/backup";
import { getBackupAlert } from "@/lib/backup-alert";
import { db } from "@/lib/db";
import { requireAdminPage } from "@/lib/session";
import { getT } from "@/i18n/server";
import { BackupsAdmin } from "./BackupsAdmin";

export async function generateMetadata() {
  const t = await getT();
  return { title: t("Copias de seguridad") };
}

export default async function BackupsPage() {
  const user = await requireAdminPage();
  const [status, files, alert, me] = await Promise.all([readStatus(), listBackups(), getBackupAlert(), db.user.findUnique({ where: { id: user.id }, select: { twoFactorMethod: true } })]);
  // Quien entra con Google y no conoce su contraseña puede confirmar la descarga con un código de su app (TOTP).
  return <BackupsAdmin keyState={backupKeyState()} alert={alert} status={status} files={files} canUseCode={me?.twoFactorMethod === "TOTP"} />;
}
