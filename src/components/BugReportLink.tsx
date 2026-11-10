"use client";

import { Bug, ExternalLink, Info } from "lucide-react";
import { useContext, useState } from "react";
import { I18nContext } from "@/i18n/context";
import { useT } from "@/i18n/client";
import { bugReportFields, bugReportUrl, describeBrowser, SECURITY_REPORT_URL, type BugReportFields, type InstallKind } from "@/lib/bug-report-core";
import { Modal } from "./ui/Modal";

// Valores fijados al compilar (next.config.ts): commit y si la build es oficial («docker», «railway» o vacío).
const COMMIT = process.env.NEXT_PUBLIC_GIT_COMMIT ?? "";
const OFFICIAL = (process.env.NEXT_PUBLIC_OFFICIAL_BUILD ?? "") as InstallKind | "";

/**
 * «Informar de un error» (Historial de versiones). Solo en builds oficiales sin modificar; antes de ir a GitHub enseña
 * qué datos técnicos se rellenarán, que hace falta cuenta de GitHub y que la incidencia es pública.
 */
export function BugReportLink({ version }: { version: string }) {
  const t = useT();
  const { locale } = useContext(I18nContext);
  const [fields, setFields] = useState<BugReportFields | null>(null);

  if (!OFFICIAL) {
    return (
      <p className="flex items-start gap-1.5 text-xs text-slate-500">
        <Info size={14} className="mt-0.5 shrink-0" />
        {t("Los informes de errores solo se atienden en versiones oficiales sin modificar, y esta instalación no usa una.")}
      </p>
    );
  }

  const open = () => setFields({ version, commit: COMMIT, install: OFFICIAL, browser: describeBrowser(navigator.userAgent), language: locale });
  const labels: Record<string, string> = {
    version: t("Versión"),
    commit: t("Commit"),
    install: t("Instalación"),
    browser: t("Navegador y sistema"),
    language: t("Idioma"),
  };

  return (
    <>
      <button type="button" className="btn-secondary w-fit py-1.5" onClick={open}>
        <Bug size={15} /> {t("Informar de un error")}
      </button>
      {fields && (
        <Modal
          open
          onClose={() => setFields(null)}
          size="sm"
          title={t("Informar de un error")}
          footer={
            <>
              <button type="button" className="btn-secondary" onClick={() => setFields(null)}>{t("Cancelar")}</button>
              <a
                href={bugReportUrl(fields)}
                target="_blank"
                rel="noopener noreferrer"
                className="btn-primary"
                onClick={() => setFields(null)}
              >
                {t("Continuar en GitHub")} <ExternalLink size={14} />
              </a>
            </>
          }
        >
          <div className="space-y-3 text-sm">
            <p>{t("Se abrirá el formulario de incidencias de Pizarro en GitHub con estos datos técnicos ya rellenos:")}</p>
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 rounded-lg bg-slate-50 p-3 text-xs dark:bg-slate-800/60">
              {bugReportFields(fields).map(([k, v]) => (
                <div key={k} className="contents">
                  <dt className="text-slate-500">{labels[k] ?? k}</dt>
                  <dd className="min-w-0 break-all font-mono">{k === "commit" ? v.slice(0, 12) : v}</dd>
                </div>
              ))}
            </dl>
            <p className="text-slate-600 dark:text-slate-300">
              {t("No se envía nada de tus proyectos ni de tu cuenta, ni tu email ni la dirección de esta instalación. Lo demás lo escribes tú, y no se publica nada hasta que lo envíes en GitHub.")}
            </p>
            <p className="text-slate-600 dark:text-slate-300">
              {t("Necesitas una cuenta de GitHub. La incidencia es pública: no incluyas datos personales ni capturas con información privada.")}
            </p>
            <p className="text-xs text-slate-500">
              {t("¿Es un fallo de seguridad? No lo publiques:")}{" "}
              <a href={SECURITY_REPORT_URL} target="_blank" rel="noopener noreferrer" className="text-brand-600 hover:underline dark:text-brand-300">
                {t("infórmalo en privado")}
              </a>
              .
            </p>
          </div>
        </Modal>
      )}
    </>
  );
}
