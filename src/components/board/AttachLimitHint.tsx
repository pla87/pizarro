"use client";

import { useIntlLocale, useT } from "@/i18n/client";
import { formatSize } from "@/lib/format-size";
import { cn } from "../ui/cn";
import { mbText } from "./upload";

/**
 * «Máx. 20 MB por archivo · 45 / 80 MB en total»: el límite por archivo y el uso de la tarea frente al máximo del proyecto.
 * Por debajo de 1 MB el uso va en KB («340 KB / 80 MB en total», como en Ajustes → Adjuntos), no «0 / 80 MB».
 * La parte del total se resalta (color de realce del tema) al llegar al máximo o si una subida se ha rechazado por él.
 */
export function AttachLimitHint({ usedBytes, limitMb, fileMaxMb, rejected = false, className }: {
  usedBytes: number;
  limitMb: number;
  fileMaxMb: number;
  rejected?: boolean;
  className?: string;
}) {
  const t = useT();
  const locale = useIntlLocale();
  const full = rejected || usedBytes >= limitMb * 1024 * 1024;
  return (
    <p className={cn("text-xs text-slate-500", className)}>
      {t("Pega o arrastra archivos.")} {t("Máx. {mb} MB por archivo", { mb: fileMaxMb })} ·{" "}
      <span data-testid="attach-total" data-full={full || undefined} className={cn(full && "font-semibold text-focus")}>
        {t("{used} / {limit} MB en total", { used: usedText(usedBytes, locale), limit: limitMb })}
      </span>
    </p>
  );
}

/** Uso de la tarea: en MB sin unidad («45»), o con su unidad por debajo de 1 MB («340 KB»); sin adjuntos, «0». */
function usedText(bytes: number, locale: string): string {
  if (bytes <= 0) return "0";
  return bytes < 1024 * 1024 ? formatSize(bytes, locale) : mbText(bytes, locale);
}
