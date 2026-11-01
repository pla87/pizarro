"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import { useT } from "@/i18n/client";
import { useToast } from "@/components/ui/Toast";
import { TRANSFER_QUEUED_EVENT, ackJob, isFinal, shownJobs, type TransferJobView } from "./client";
import { downloadUrl } from "./TransferJobs";

const POLL_MS = 4000;

/**
 * Avisa con un aviso emergente de que una exportación o importación terminó cuando la persona ya cerró su diálogo (o
 * cambió de página). Al cargar, mira lo pendiente; mientras algo siga en curso, consulta cada pocos segundos.
 */
export function TransferJobWatcher() {
  const t = useT();
  const toast = useToast();
  const router = useRouter();
  const latest = useRef({ t, toast, router });
  useEffect(() => {
    latest.current = { t, toast, router };
  });
  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const check = async () => {
      clearTimeout(timer);
      let jobs: TransferJobView[] = [];
      try {
        const res = await fetch("/api/transfer-jobs?pending=1", { cache: "no-store" });
        if (res.ok) jobs = ((await res.json()) as { jobs: TransferJobView[] }).jobs;
      } catch {
        // sin red: se vuelve a intentar enseguida
      }
      if (stopped) return;
      const { t, toast, router } = latest.current;
      for (const job of jobs) {
        if (!isFinal(job.status) || job.notified || shownJobs.has(job.id) || job.status === "EXPIRED") continue;
        ackJob(job.id);
        if (job.status === "FAILED") {
          toast(job.kind === "EXPORT" ? t("No se pudo exportar el proyecto.") + (job.error ? ` ${job.error}` : "") : t("No se pudo importar el proyecto.") + (job.error ? ` ${job.error}` : ""), "error");
        } else if (job.kind === "EXPORT") {
          toast(t("Exportación lista: ya puedes descargarla."), "success", { label: t("Descargar"), onClick: () => { window.location.href = downloadUrl(job.id); } });
        } else {
          const name = job.result && "counts" in job.result ? job.result.name : "";
          router.refresh();
          toast(t("Proyecto «{name}» importado.", { name }), "success", job.projectId ? { label: t("Abrir proyecto"), onClick: () => router.push(`/p/${job.projectId}`) } : undefined);
        }
      }
      if (jobs.some((j) => !isFinal(j.status))) timer = setTimeout(check, POLL_MS);
    };
    void check();
    const onQueued = () => void check();
    window.addEventListener(TRANSFER_QUEUED_EVENT, onQueued);
    return () => {
      stopped = true;
      clearTimeout(timer);
      window.removeEventListener(TRANSFER_QUEUED_EVENT, onQueued);
    };
  }, []);
  return null;
}
