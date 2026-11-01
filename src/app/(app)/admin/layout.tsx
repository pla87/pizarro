import { requireAdminPage } from "@/lib/session";
import { getT } from "@/i18n/server";
import { getUpdateNotice, runsOnRailway } from "@/lib/update-check";
import { AdminTabs } from "./AdminTabs";
import { UpdateNotice } from "./UpdateNotice";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await requireAdminPage();
  const t = await getT();
  const update = await getUpdateNotice();
  return (
    <div className="mx-auto max-w-4xl space-y-4 p-4 sm:p-6">
      <h1 className="text-xl font-bold">{t("Administración")}</h1>
      {update && <UpdateNotice version={update.version} url={update.url} railway={runsOnRailway()} />}
      <AdminTabs />
      {children}
    </div>
  );
}
