import type { T } from "@/i18n/shared";

type Toast = (message: string, kind?: "success" | "error", action?: { label: string; onClick: () => void }) => void;

/**
 * Descarga el ZIP de adjuntos de una release o de un plan de trabajo (la misma ruta, `release-attachments`, con sus
 * mismos topes y permisos). Primero pide el plan (cuántos paquetes caben en el tope del proyecto) y luego cada paquete,
 * uno tras otro, con el token del plan: si los adjuntos cambian a mitad, el servidor responde 409 y se ofrece reintentar.
 * `items`: `{ taskId, code }` (release) o `{ taskId, folder }` (plan). `fileName`: nombre de cada paquete.
 */
export async function downloadAttachmentsZip(opts: {
  projectId: string;
  items: ({ taskId: string; code: string } | { taskId: string; folder: string })[];
  fileName: (part: number, total: number) => string;
  t: T;
  toast: Toast;
}): Promise<void> {
  const { projectId, items, fileName, t, toast } = opts;
  let changed: string | null = null;
  try {
    const url = `/api/projects/${projectId}/release-attachments`;
    const body = JSON.stringify({ items });
    const post = (query: string) => fetch(`${url}${query}`, { method: "POST", headers: { "Content-Type": "application/json" }, body });
    const planRes = await post("?plan=1");
    if (!planRes.ok) throw new Error(planRes.status === 429 ? await planRes.text() : "");
    const plan = (await planRes.json()) as { parts: { oversize: boolean }[]; maxMb: number; v?: string };
    const total = plan.parts.length;
    for (let part = 1; part <= total; part++) {
      const res = await post(`?part=${part}${plan.v ? `&v=${plan.v}` : ""}`);
      if (res.status === 409) {
        changed = await res.text();
        throw new Error(changed);
      }
      if (!res.ok) throw new Error(res.status === 429 ? await res.text() : "");
      const href = URL.createObjectURL(await res.blob());
      const a = document.createElement("a");
      a.href = href;
      a.download = fileName(part, total);
      a.click();
      setTimeout(() => URL.revokeObjectURL(href), 1000);
      // Pausa corta para que el navegador no agrupe ni descarte las descargas seguidas.
      if (part < total) await new Promise((r) => setTimeout(r, 400));
    }
    if (total > 1) toast(t("Adjuntos descargados en {n} paquetes de hasta {mb} MB", { n: total, mb: plan.maxMb }));
    if (plan.parts.some((p) => p.oversize)) toast(t("Algún archivo supera por sí solo los {mb} MB y va en su propio paquete.", { mb: plan.maxMb }), "error");
  } catch (e) {
    const message = e instanceof Error && e.message ? e.message : t("No se pudieron descargar los adjuntos");
    // Adjuntos cambiados durante la descarga: se ofrece volver a empezar (nuevo plan y todos los paquetes).
    toast(message, "error", changed ? { label: t("Reintentar"), onClick: () => void downloadAttachmentsZip(opts) } : undefined);
  }
}
