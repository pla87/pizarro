import { listKinds } from "@/lib/board";
import { db } from "@/lib/db";
import { requireAdminPage } from "@/lib/session";
import { KindsAdmin } from "./KindsAdmin";

export const metadata = { title: "Tipos de tarea" };

export default async function KindsPage() {
  await requireAdminPage();
  const [kinds, counts] = await Promise.all([
    listKinds(),
    db.task.groupBy({ by: ["kindId"], _count: { _all: true } }),
  ]);
  const usage = Object.fromEntries(counts.map((c) => [c.kindId, c._count._all]));
  return <KindsAdmin kinds={kinds.map((k) => ({ ...k, taskCount: usage[k.id] ?? 0 }))} />;
}
