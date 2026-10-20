"use client";

import { FileDown, Loader2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { useT } from "@/i18n/client";

type State = { status: "loading" } | { status: "ready"; url: string; filename: string } | { status: "error"; message: string };

const CLASSES = {
  sidebar: "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800",
  header: "btn-secondary",
};

/** Informe PDF: en escritorio se abre en una pestaña; en móvil o app instalada se genera y se ofrece descargar. */
export function ReportButton({ projectId, variant }: { projectId: string; variant: "sidebar" | "header" }) {
  const t = useT();
  const endpoint = `/api/projects/${projectId}/report`;
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<State>({ status: "loading" });
  const urlRef = useRef<string | null>(null);

  const revoke = useCallback(() => {
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    urlRef.current = null;
  }, []);

  const generate = useCallback(async () => {
    revoke();
    setState({ status: "loading" });
    try {
      const res = await fetch(endpoint, { cache: "no-store" });
      if (!res.ok) throw new Error(res.status === 429 ? t("Demasiadas peticiones, espera un momento.") : t("No se pudo generar el informe."));
      const blob = await res.blob();
      const name = /filename="?([^";]+)"?/i.exec(res.headers.get("Content-Disposition") ?? "")?.[1];
      const url = URL.createObjectURL(blob);
      urlRef.current = url;
      setState({ status: "ready", url, filename: name ?? `informe-${new Date().toISOString().slice(0, 10)}.pdf` });
    } catch (err) {
      setState({ status: "error", message: err instanceof Error ? err.message : t("No se pudo generar el informe.") });
    }
  }, [endpoint, revoke, t]);

  useEffect(() => revoke, [revoke]);

  function onClick() {
    const desktop = window.matchMedia("(min-width: 1024px)").matches;
    const standalone = window.matchMedia("(display-mode: standalone)").matches;
    if (desktop && !standalone) {
      window.open(endpoint, "_blank", "noopener");
      return;
    }
    setOpen(true);
    void generate();
  }

  function close() {
    setOpen(false);
    revoke();
  }

  return (
    <>
      <button type="button" className={CLASSES[variant]} onClick={onClick}>
        <FileDown size={variant === "sidebar" ? 17 : 16} /> {t("Informe PDF")}
      </button>
      <Modal open={open} onClose={close} title={t("Informe PDF")} size="sm">
        {state.status === "loading" && (
          <p className="flex items-center gap-2 py-4 text-sm text-slate-600 dark:text-slate-300">
            <Loader2 size={18} className="animate-spin" /> {t("Generando informe…")}
          </p>
        )}
        {state.status === "error" && (
          <div className="space-y-3 py-2">
            <p className="text-sm text-red-600">{state.message}</p>
            <button type="button" className="btn-secondary" onClick={() => void generate()}>{t("Reintentar")}</button>
          </div>
        )}
        {state.status === "ready" && (
          <div className="space-y-3 py-2">
            <p className="text-sm text-slate-600 dark:text-slate-300">{t("El informe está listo.")}</p>
            <div className="flex gap-2">
              <a className="btn-primary" href={state.url} download={state.filename}>
                <FileDown size={16} /> {t("Descargar")}
              </a>
              <button type="button" className="btn-secondary" onClick={() => window.open(state.url, "_blank")}>{t("Abrir")}</button>
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}
