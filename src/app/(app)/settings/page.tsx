import { db } from "@/lib/db";
import { requireUserPage } from "@/lib/session";
import { ProfileSettings } from "./ProfileSettings";

export const metadata = { title: "Mi perfil y plantillas" };

export default async function SettingsPage() {
  const user = await requireUserPage();
  const row = await db.user.findUniqueOrThrow({
    where: { id: user.id },
    select: { name: true, email: true, releaseHeaderTemplate: true, releaseFooterTemplate: true },
  });
  return <ProfileSettings name={row.name} email={row.email} header={row.releaseHeaderTemplate} footer={row.releaseFooterTemplate} />;
}
