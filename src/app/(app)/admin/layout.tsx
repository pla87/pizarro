import { requireAdminPage } from "@/lib/session";
import { getT } from "@/i18n/server";
import { setupCodeSource } from "@/lib/setup-core";
import { getUpdateNotice } from "@/lib/update-check";
import { lowDiskSpace } from "@/lib/health";
import { getOtherInstanceNotice } from "@/lib/instance-lock";
import { uploadDir } from "@/lib/upload-dir";
import { AdminTabs } from "./AdminTabs";
import { DiskNotice } from "./DiskNotice";
import { InstanceNotice } from "./InstanceNotice";
import { UpdateNotice } from "./UpdateNotice";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await requireAdminPage();
  const t = await getT();
  const [update, disk, otherInstance] = await Promise.all([getUpdateNotice(), lowDiskSpace(uploadDir()), getOtherInstanceNotice()]);
  return (
    // max-w-5xl: las nueve pestañas caben en una fila en escritorio (en el móvil se desplazan, ScrollTabs).
    <div className="mx-auto max-w-5xl space-y-4 p-4 sm:p-6">
      <h1 className="text-xl font-bold">{t("Administración")}</h1>
      {otherInstance && <InstanceNotice since={otherInstance.since} />}
      {disk && <DiskNotice freeBytes={disk.freeBytes} minBytes={disk.minBytes} />}
      {update && <UpdateNotice version={update.version} url={update.url} platform={setupCodeSource()} />}
      <AdminTabs />
      {children}
    </div>
  );
}
