"use client";

import { MonitorSmartphone } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { revokeOtherSessions, revokeSession } from "@/actions/profile";
import { useToast } from "@/components/ui/Toast";
import { useIntlLocale, useT } from "@/i18n/client";
import { formatDate } from "@/lib/format";

export interface SessionRow {
  id: string;
  /** Navegador y sistema ya traducidos («Chrome en Windows»). */
  device: string;
  ip: string | null;
  lastSeenAt: string;
  createdAt: string;
  current: boolean;
}

/** «Sesiones abiertas»: dispositivos con la sesión iniciada, con opción de cerrarlos. */
export function SessionsSection({ sessions }: { sessions: SessionRow[] }) {
  const t = useT();
  const locale = useIntlLocale();
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const others = sessions.filter((s) => !s.current).length;

  const run = (fn: () => ReturnType<typeof revokeSession>, ok: string) =>
    start(async () => {
      const res = await fn();
      toast(res.ok ? ok : res.error, res.ok ? "success" : "error");
      if (res.ok) router.refresh();
    });

  return (
    <section className="card p-5">
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="font-semibold">{t("Sesiones abiertas")}</h2>
          <p className="mt-0.5 text-sm text-slate-500">{t("Dispositivos en los que has iniciado sesión. Cierra los que no reconozcas.")}</p>
        </div>
        {others > 0 && (
          <button className="btn-secondary" disabled={pending} onClick={() => run(() => revokeOtherSessions(), t("Se han cerrado las demás sesiones"))}>
            {t("Cerrar las demás")}
          </button>
        )}
      </div>
      <ul className="mt-4 divide-y divide-slate-200 dark:divide-slate-800">
        {sessions.map((s) => (
          <li key={s.id} className="flex items-center gap-3 py-3">
            <MonitorSmartphone size={20} className="shrink-0 text-slate-400" aria-hidden />
            <div className="min-w-0 flex-1 text-sm">
              <div className="flex flex-wrap items-center gap-2 font-medium">
                {s.device}
                {s.current && <span className="badge bg-brand-50 text-brand-700 ring-brand-500/20">{t("Esta sesión")}</span>}
              </div>
              <div className="text-xs text-slate-500">
                {s.ip ? `IP ${s.ip} · ` : ""}
                {t("Última actividad: {date}", { date: formatDate(s.lastSeenAt, "dateTimeShort", locale) })}
              </div>
            </div>
            {!s.current && (
              <button className="btn-secondary" disabled={pending} onClick={() => run(() => revokeSession(s.id), t("Sesión cerrada"))}>
                {t("Cerrar")}
              </button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
