import { requireAdminPage } from "@/lib/session";
import { getT } from "@/i18n/server";
import { AdminTabs } from "./AdminTabs";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await requireAdminPage();
  const t = await getT();
  return (
    <div className="mx-auto max-w-4xl space-y-4 p-4 sm:p-6">
      <h1 className="text-xl font-bold">{t("Administración")}</h1>
      <AdminTabs />
      {children}
    </div>
  );
}
