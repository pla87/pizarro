import { listKinds } from "@/lib/board";
import { db } from "@/lib/db";
import { requireAdminPage } from "@/lib/session";
import { getT } from "@/i18n/server";
import { KindsAdmin } from "./KindsAdmin";

export async function generateMetadata() {
  const t = await getT();
  return { title: t("Tipos de tarea") };
}

export default async function KindsPage() {
  const user = await requireAdminPage();
  const [kinds, counts, me] = await Promise.all([
    listKinds(),
    db.task.groupBy({ by: ["kindId"], _count: { _all: true } }),
    db.user.findUnique({ where: { id: user.id }, select: { editorMode: true } }),
  ]);
  const editorMode = me?.editorMode ?? "MARKDOWN";
  const usage = Object.fromEntries(counts.map((c) => [c.kindId, c._count._all]));
  return <KindsAdmin editorMode={editorMode} kinds={kinds.map((k) => ({ ...k, taskCount: usage[k.id] ?? 0 }))} />;
}
