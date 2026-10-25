import { collectDiagnostics } from "@/lib/doctor";
import { logEvent } from "@/lib/log";
import { rateLimit } from "@/lib/rate-limit";
import { getCurrentUser } from "@/lib/session";
import { getT } from "@/i18n/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Descarga el diagnóstico para soporte (JSON sin datos personales ni secretos). Solo administradores; 5 cada 10 minutos. */
export async function GET() {
  const t = await getT();
  const user = await getCurrentUser();
  if (!user) return new Response(t("No autorizado"), { status: 401 });
  if (user.role !== "ADMIN") return new Response(t("Prohibido"), { status: 403 });
  if (!rateLimit(`doctor:${user.id}`, 5, 10 * 60_000)) {
    return new Response(t("Demasiadas descargas del diagnóstico. Espera unos minutos."), { status: 429, headers: { "Cache-Control": "no-store" } });
  }
  const report = await collectDiagnostics({ source: "app" });
  logEvent({ category: "api", action: "admin.doctor", message: "Descarga del diagnóstico", userId: user.id, userName: user.name, path: "/api/admin/doctor" });
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
  return new Response(JSON.stringify(report, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="diagnostico-pizarro-${stamp}.json"`,
      "Cache-Control": "no-store",
    },
  });
}
