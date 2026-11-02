import { actionContext } from "@/lib/action-context";
import { AppError } from "@/lib/errors";
import { getCurrentUser } from "@/lib/session";
import { getJobFor, toView } from "@/lib/transfer-jobs";
import { getT } from "@/i18n/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Estado de una exportación o importación: solo quien la pidió (los demás, administradores incluidos, reciben 404). */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  return actionContext.run({}, async () => {
    const t = await getT();
    const user = await getCurrentUser();
    if (!user) return Response.json({ error: t("No autorizado") }, { status: 401 });
    try {
      const job = await getJobFor(user, (await ctx.params).id);
      return Response.json(await toView(job, t), { headers: { "Cache-Control": "private, no-store" } });
    } catch (err) {
      if (err instanceof AppError) return Response.json({ error: t(err.message) }, { status: err.status });
      throw err;
    }
  });
}
