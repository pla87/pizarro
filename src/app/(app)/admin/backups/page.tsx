import { backupKeyState, listBackups, readStatus } from "@/lib/backup";
import { requireAdminPage } from "@/lib/session";
import { getT } from "@/i18n/server";
import { BackupsAdmin } from "./BackupsAdmin";

export async function generateMetadata() {
  const t = await getT();
  return { title: t("Copias de seguridad") };
}

export default async function BackupsPage() {
  await requireAdminPage();
  const [status, files] = await Promise.all([readStatus(), listBackups()]);
  return <BackupsAdmin keyState={backupKeyState()} status={status} files={files} />;
}
