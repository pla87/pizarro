import { headers } from "next/headers";
import { AuthCard } from "@/components/auth/AuthCard";
import { getT } from "@/i18n/server";
import { makeT } from "@/i18n/core";
import { toLocale } from "@/i18n/shared";
import type { T } from "@/i18n/core";
import { rateIp, rateLimit } from "@/lib/rate-limit";
import { clientIp } from "@/lib/request";
import { resolveUnsubscribe, type UnsubscribeTarget } from "@/lib/unsubscribe";

/** Traductor en el idioma de la persona del enlace; sin ella (informe, enlace no válido), el de la instancia. */
async function tFor(target: UnsubscribeTarget | null) {
  return target?.locale ? makeT(toLocale(target.locale)) : getT();
}

// El título de la pestaña, en el idioma de la instancia: resolver aquí el token sería una consulta antes del tope de intentos.
export async function generateMetadata() {
  const t = await getT();
  return { title: t("Dejar de recibir estos emails"), robots: { index: false, follow: false } };
}

/** Qué deja de llegar, en una frase corta («los emails de…»). */
function what(target: UnsubscribeTarget, t: T): string {
  switch (target.kind) {
    case "mention":
    case "note": return t("los emails de menciones en tareas y notas");
    case "assigned": return t("los emails de las tareas que te asignan");
    case "due": return t("los emails de cambios de fecha límite y recordatorios de «Esperando»");
    case "comment": return t("los emails de comentarios y respuestas en tareas que sigues");
    case "admin": return t("los emails de administración de Pizarro");
    case "digest": return t("los emails sobre proyectos del resumen diario");
    default: return t("el informe semanal del proyecto «{project}»", { project: target.projectName ?? "" });
  }
}

/**
 * Enlace «Dejar de recibir estos emails» del pie de los avisos, el resumen diario y el informe semanal. Abrir la página
 * no cambia nada (los gestores de correo y los antivirus abren los enlaces): hay que pulsar el botón, que hace el mismo
 * POST que la baja en un clic (/api/unsubscribe/<token>) y vuelve aquí. Sin sesión y sin mostrar la dirección de email.
 */
export default async function UnsubscribePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!rateLimit(`unsub:page:${rateIp(clientIp(await headers()))}`, 60, 10 * 60_000)) {
    const t = await getT();
    return <AuthCard title={t("Dejar de recibir estos emails")}><p className="text-sm">{t("Demasiados intentos. Espera unos minutos.")}</p></AuthCard>;
  }
  const target = await resolveUnsubscribe(token);
  const t = await tFor(target);
  const title = t("Dejar de recibir estos emails");
  if (!target) {
    return (
      <AuthCard title={t("Enlace no válido")}>
        <p className="text-sm">{t("Este enlace para dejar de recibir emails no es válido o ya no sirve (por ejemplo, porque ha cambiado la dirección de destino).")}</p>
      </AuthCard>
    );
  }
  const report = target.kind === "report";
  const again = report
    ? t("Nadie más podrá volver a enviártelo: solo tú puedes reactivarlo, en los ajustes del proyecto (si tienes cuenta en Pizarro).")
    : target.kind === "digest"
      ? t("Puedes volver a activarlo en «Mi perfil → Avisos».")
      : t("Los avisos seguirán apareciendo en la campana de Pizarro, y puedes volver a activarlos en «Mi perfil → Avisos».");
  return (
    <AuthCard title={title}>
      <div className="space-y-4 text-sm">
        {target.receiving ? (
          <>
            <p>{t("Dejarás de recibir {what}. Los demás emails no cambian.", { what: what(target, t) })}</p>
            <form method="post" action={`/api/unsubscribe/${encodeURIComponent(token)}`}>
              <input type="hidden" name="confirm" value="1" />
              <button className="btn-primary w-full">{t("Darme de baja")}</button>
            </form>
          </>
        ) : (
          <p role="status">{t("Hecho: ya no recibirás {what}.", { what: what(target, t) })}</p>
        )}
        <p className="text-slate-500">{again}</p>
        {/* Recarga completa (no Link): la página siguiente puede ir en otro idioma. */}
        {!report && <a href="/settings?tab=avisos" className="btn-secondary w-full">{t("Ir a mi perfil")}</a>}
      </div>
    </AuthCard>
  );
}
