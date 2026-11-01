import { actionContext } from "@/lib/action-context";
import { getCurrentUser } from "@/lib/session";
import { listRecentJobs, toView, type TransferKind } from "@/lib/transfer-jobs";
import { getT } from "@/i18n/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Exportaciones e importaciones recientes (últimas 24 h) de quien pregunta, solo las suyas (también para administradores).
 * `?kind=EXPORT|IMPORT` y `?projectId=` filtran; con `?pending=1` solo las que aún corren o terminaron sin avisar.
 */
export async function GET(req: Request) {
  return actionContext.run({}, async () => {
    const t = await getT();
    const user = await getCurrentUser();
    if (!user) return Response.json({ error: t("No autorizado") }, { status: 401 });
    const sp = new URL(req.url).searchParams;
    const kind = sp.get("kind");
    const projectId = sp.get("projectId");
    const jobs = await listRecentJobs(user.id, {
      ...(kind === "EXPORT" || kind === "IMPORT" ? { kind: kind as TransferKind } : {}),
      ...(projectId && /^[\w-]{1,40}$/.test(projectId) ? { projectId } : {}),
    });
    const views = await Promise.all(jobs.map((j) => toView(j, t)));
    const pending = sp.get("pending") === "1";
    return Response.json({ jobs: pending ? views.filter((v) => !v.notified || v.status === "QUEUED" || v.status === "RUNNING") : views }, { headers: { "Cache-Control": "private, no-store" } });
  });
}
