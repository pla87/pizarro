import { requireAdminPage } from "@/lib/session";
import { AdminTabs } from "./AdminTabs";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await requireAdminPage();
  return (
    <div className="mx-auto max-w-4xl space-y-4 p-4 sm:p-6">
      <h1 className="text-xl font-bold">Administración</h1>
      <AdminTabs />
      {children}
    </div>
  );
}
