import { actionContext } from "@/lib/action-context";
import { AppError } from "@/lib/errors";
import { isSameOrigin } from "@/lib/request";
import { getCurrentUser } from "@/lib/session";
import { acknowledgeJob } from "@/lib/transfer-jobs";
import { getT } from "@/i18n/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Marca el trabajo como visto por su dueño (el aviso emergente de «terminó» no se repite). */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return actionContext.run({}, async () => {
    const t = await getT();
    if (!isSameOrigin(req)) return Response.json({ error: t("Origen no permitido.") }, { status: 403 });
    const user = await getCurrentUser();
    if (!user) return Response.json({ error: t("No autorizado") }, { status: 401 });
    try {
      await acknowledgeJob(user, (await ctx.params).id);
      return Response.json({ ok: true });
    } catch (err) {
      if (err instanceof AppError) return Response.json({ error: t(err.message) }, { status: err.status });
      throw err;
    }
  });
}
