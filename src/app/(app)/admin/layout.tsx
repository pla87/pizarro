import { requireAdminPage } from "@/lib/session";
import { getT } from "@/i18n/server";
import { getUpdateNotice, runsOnRailway } from "@/lib/update-check";
import { lowDiskSpace } from "@/lib/health";
import { uploadDir } from "@/lib/upload-dir";
import { AdminTabs } from "./AdminTabs";
import { DiskNotice } from "./DiskNotice";
import { UpdateNotice } from "./UpdateNotice";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await requireAdminPage();
  const t = await getT();
  const [update, disk] = await Promise.all([getUpdateNotice(), lowDiskSpace(uploadDir())]);
  return (
    // max-w-5xl: las nueve pestañas caben en una fila en escritorio (en el móvil se desplazan, ScrollTabs).
    <div className="mx-auto max-w-5xl space-y-4 p-4 sm:p-6">
      <h1 className="text-xl font-bold">{t("Administración")}</h1>
      {disk && <DiskNotice freeBytes={disk.freeBytes} minBytes={disk.minBytes} />}
      {update && <UpdateNotice version={update.version} url={update.url} railway={runsOnRailway()} />}
      <AdminTabs />
      {children}
    </div>
  );
}
