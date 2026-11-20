import type { T } from "@/i18n/shared";

type Toast = (message: string, kind?: "success" | "error", action?: { label: string; onClick: () => void }) => void;

/**
 * Descarga directa del navegador (con su progreso y su botón de cancelar; nada pasa por la memoria de la página, y si se
 * sale de ella la descarga sigue o se cancela desde el navegador). `name` solo es una sugerencia: manda el
 * Content-Disposition del servidor.
 */
export function startDownload(href: string, name: string): void {
  const a = document.createElement("a");
  a.href = href;
  a.download = name;
  a.rel = "noopener";
  document.body.append(a);
  a.click();
  a.remove();
}

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** Un paquete que no ha empezado a enviarse en este tiempo (ni ha fallado) se da por perdido. */
const START_TIMEOUT_MS = 45_000;

type TicketStatus = { started: number[]; done: number[]; errors: Record<string, { status: number; message: string }> };

/**
 * Espera a que el paquete `part` empiece a enviarse (el último) o termine (los demás: cada persona descarga un ZIP a la
 * vez, así que el siguiente se pide cuando acaba el anterior), consultando el vale cada segundo. Devuelve su error, si falla.
 */
async function waitForPart(statusUrl: string, part: number, untilDone: boolean): Promise<{ status: number; message: string } | null> {
  const since = Date.now();
  for (;;) {
    await pause(1000);
    const res = await fetch(statusUrl, { cache: "no-store" });
    if (!res.ok) return { status: res.status, message: "" };
    const st = (await res.json()) as TicketStatus;
    const error = st.errors[String(part)];
    if (error) return error;
    if (st.done.includes(part) || (!untilDone && st.started.includes(part))) return null;
    if (!st.started.includes(part) && Date.now() - since > START_TIMEOUT_MS) return { status: 0, message: "" };
  }
}

/**
 * Descarga el ZIP de adjuntos de una release o de un plan de trabajo (la misma ruta, `release-attachments`, con sus
 * mismos topes y permisos). Primero pide el plan (cuántos paquetes caben en el tope del proyecto, con un vale para esta
 * lista de tareas) y luego cada paquete en descarga directa del navegador, uno tras otro, con el token del plan: si los
 * adjuntos cambian a mitad, el servidor responde 409 (queda en el vale) y se ofrece reintentar.
 * `items`: `{ taskId, code }` (release) o `{ taskId, folder }` (plan). `fileName`: nombre de cada paquete.
 */
export async function downloadAttachmentsZip(opts: {
  projectId: string;
  items: ({ taskId: string; code: string } | { taskId: string; folder: string })[];
  fileName: (part: number, total: number) => string;
  t: T;
  toast: Toast;
  /** Estado «descargando» del botón: lo activa y lo apaga esta función, también en el reintento. */
  setBusy?: (busy: boolean) => void;
}): Promise<void> {
  const { projectId, items, fileName, t, toast, setBusy } = opts;
  let changed = false;
  setBusy?.(true);
  try {
    const url = `/api/projects/${projectId}/release-attachments`;
    const planRes = await fetch(`${url}?plan=1`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ items }) });
    if (!planRes.ok) throw new Error(planRes.status === 429 ? await planRes.text() : "");
    const plan = (await planRes.json()) as { parts: { oversize: boolean }[]; maxMb: number; v?: string; ticket?: string; busy?: boolean };
    if (!plan.ticket) throw new Error("");
    if (plan.busy) throw new Error(t("Ya se está preparando otro ZIP. Inténtalo de nuevo en unos segundos."));
    const total = plan.parts.length;
    const ticket = encodeURIComponent(plan.ticket);
    for (let part = 1; part <= total; part++) {
      const name = fileName(part, total);
      startDownload(`${url}?ticket=${ticket}&part=${part}${plan.v ? `&v=${plan.v}` : ""}&name=${encodeURIComponent(name)}`, name);
      const error = await waitForPart(`${url}?ticket=${ticket}&status=1`, part, part < total);
      if (error) {
        changed = error.status === 409;
        throw new Error(error.message);
      }
    }
    if (total > 1) toast(t("Adjuntos descargados en {n} paquetes de hasta {mb} MB", { n: total, mb: plan.maxMb }));
    if (plan.parts.some((p) => p.oversize)) toast(t("Algún archivo supera por sí solo los {mb} MB y va en su propio paquete.", { mb: plan.maxMb }), "error");
  } catch (e) {
    const message = e instanceof Error && e.message ? e.message : t("No se pudieron descargar los adjuntos");
    // Adjuntos cambiados durante la descarga: se ofrece volver a empezar (nuevo plan y todos los paquetes).
    toast(message, "error", changed ? { label: t("Reintentar"), onClick: () => void downloadAttachmentsZip(opts) } : undefined);
  } finally {
    setBusy?.(false);
  }
}
