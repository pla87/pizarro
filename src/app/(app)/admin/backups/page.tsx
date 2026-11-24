import { backupDestinationsInfo, backupKeyProblem, backupKeyState, backupPaused, externalCopyRunning, listBackupsCached, readStatus } from "@/lib/backup";
import { getBackupAlert } from "@/lib/backup-alert";
import { maskDestinationLabel, maskHostIn, maskHostsIn } from "@/lib/backup-label";
import { db } from "@/lib/db";
import { listJobRuns } from "@/lib/jobs";
import { SCHEDULED_JOBS } from "@/lib/maintenance";
import { requireAdminPage } from "@/lib/session";
import { setupCodeSource } from "@/lib/setup-core";
import { getT } from "@/i18n/server";
import type { T } from "@/i18n/core";
import { storedText } from "@/lib/log-legacy";
import { BackupsAdmin } from "./BackupsAdmin";

export async function generateMetadata() {
  const t = await getT();
  return { title: t("Copias de seguridad") };
}

export default async function BackupsPage() {
  const user = await requireAdminPage();
  const [status, files, alert, me, jobs] = await Promise.all([readStatus(), listBackupsCached(), getBackupAlert(), db.user.findUnique({ where: { id: user.id }, select: { twoFactorMethod: true } }), listJobRuns()]);
  // Tareas en el orden en que se ejecutan (el correo, que va aparte, primero; las desconocidas, al final).
  const rank = (name: string) => {
    const i = SCHEDULED_JOBS.findIndex((j) => j.name === name);
    return i < 0 ? SCHEDULED_JOBS.length : i;
  };
  jobs.sort((a, b) => rank(a.name) - rank(b.name));
  // Quien entra con Google y no conoce su contraseña puede confirmar la descarga con un código de su app (TOTP).
  // El host de un almacenamiento S3 (con el id de la cuenta en R2) se recorta antes de llegar al navegador.
  const masked = maskForView(status, backupDestinationsInfo(), jobs, await getT());
  return (
    <BackupsAdmin
      keyState={backupKeyState()}
      keyProblem={backupKeyProblem()}
      alert={alert}
      status={masked.status}
      files={files}
      canUseCode={me?.twoFactorMethod === "TOTP"}
      jobs={masked.jobs}
      destinations={masked.destinations}
      externalRunning={externalCopyRunning()}
      paused={backupPaused()}
      platform={setupCodeSource()}
    />
  );
}

/**
 * Lo que llega al navegador: sin el host de los destinos y con los errores y avisos guardados (en español) en el idioma de
 * quien lo ve (storedText: los textos fijos y las plantillas de es-text.ts).
 */
function maskForView(status: Awaited<ReturnType<typeof readStatus>>, destinations: ReturnType<typeof backupDestinationsInfo>, jobs: Awaited<ReturnType<typeof listJobRuns>>, t: T) {
  const tr = (s: string) => storedText(s, t);
  const runText = <R extends { error?: string }>(r: R | undefined): R | undefined => (r?.error ? { ...r, error: tr(r.error) } : r);
  const external = Object.fromEntries(
    Object.entries(status.external ?? {}).map(([id, st]) => {
      const last = st?.last;
      return [id, last ? { ...st, last: { ...last, label: maskDestinationLabel(last.label), ...(last.error ? { error: tr(maskHostIn(last.error, last.label)) } : {}), ...(last.warning ? { warning: tr(last.warning) } : {}) } } : st];
    }),
  ) as typeof status.external;
  // El último error de las tareas programadas (la copia externa entre ellas) puede llevar el host de cualquier destino,
  // también de uno que ya no está configurado pero sigue en el estado guardado.
  const labels = [...destinations.external.map((d) => d.label), ...Object.values(status.external ?? {}).flatMap((st) => (st?.last?.label ? [st.last.label] : []))];
  return {
    jobs: jobs.map((j) => (j.lastError ? { ...j, lastError: tr(maskHostsIn(j.lastError, labels)) } : j)),
    status: { ...status, lastBackup: runText(status.lastBackup), lastRestoreTest: runText(status.lastRestoreTest), ...(status.external ? { external } : {}) },
    destinations: {
      ...destinations,
      external: destinations.external.map((d) => ({ ...d, label: maskDestinationLabel(d.label) })),
      errors: destinations.errors.map((e) => tr(maskHostsIn(e, destinations.external.map((d) => d.label)))),
    },
  };
}
