import { Server } from "lucide-react";
import { getLocale, getT } from "@/i18n/server";
import { formatDate } from "@/lib/format";
import { intlLocale } from "@/i18n/core";

/**
 * Aviso de otra copia de Pizarro usando la misma base de datos (lib/instance-lock.ts) en Administración. No se puede
 * ocultar: sale mientras dure (y hasta un minuto y medio después de que la otra copia se pare).
 */
export async function InstanceNotice({ since }: { since: string }) {
  const t = await getT();
  const locale = intlLocale(await getLocale());
  return (
    <div role="alert" data-testid="instance-notice" className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100">
      <Server className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="font-medium">{t("Hay otra copia de Pizarro usando esta misma base de datos (desde {date}).", { date: formatDate(since, "dateTime", locale) })}</p>
        <p className="text-xs opacity-80">
          {t("Dos copias a la vez se pisan: el bot de Telegram por sondeo pierde mensajes, las tareas de fondo y las copias de seguridad se reparten entre las dos y cada una tiene sus propios archivos subidos. Detén la que sobra: otro servicio o un despliegue antiguo en Railway, otro servidor o una prueba con esta misma DATABASE_URL.")}
        </p>
      </div>
    </div>
  );
}
