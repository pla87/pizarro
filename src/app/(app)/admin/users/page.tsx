import { db } from "@/lib/db";
import { MAX_USERS } from "@/lib/limits";
import { requireAdminPage } from "@/lib/session";
import { UsersAdmin } from "./UsersAdmin";

export const metadata = { title: "Usuarios" };

export default async function UsersPage() {
  const me = await requireAdminPage();
  const users = await db.user.findMany({
    orderBy: [{ active: "desc" }, { name: "asc" }],
    select: { id: true, name: true, email: true, role: true, active: true },
  });
  return <UsersAdmin users={users} meId={me.id} maxUsers={MAX_USERS} />;
}
