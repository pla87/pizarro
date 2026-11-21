import Link from "next/link";
import { HardDrive } from "lucide-react";
import { intlLocale } from "@/i18n/core";
import { getLocale, getT } from "@/i18n/server";
import { formatSize } from "@/lib/format-size";

/**
 * Aviso de disco casi lleno en Administración (por debajo de HEALTH_MIN_FREE_MB en la carpeta de subidas). No se puede
 * ocultar: sale mientras dure. /api/health ya no responde 503 por esto (lo da como aviso), así que es aquí donde se ve.
 */
export async function DiskNotice({ freeBytes, minBytes }: { freeBytes: number; minBytes: number }) {
  const t = await getT();
  const locale = intlLocale(await getLocale());
  return (
    <div role="alert" className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100">
      <HardDrive className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="font-medium">{t("El disco del servidor está casi lleno: quedan {free} libres (el mínimo es {min}).", { free: formatSize(freeBytes, locale), min: formatSize(minBytes, locale) })}</p>
        <p className="text-xs opacity-80">
          {t("Con el disco lleno no se pueden subir archivos ni hacer copias de seguridad. Libera espacio o amplía el volumen.")}{" "}
          <Link className="font-medium underline underline-offset-2" href="/admin/settings#storage-title">{t("Ver el almacenamiento")}</Link>
        </p>
      </div>
    </div>
  );
}
