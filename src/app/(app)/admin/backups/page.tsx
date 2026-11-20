import { backupDestinationsInfo, backupKeyProblem, backupKeyState, backupPaused, externalCopyRunning, listBackupsCached, readStatus } from "@/lib/backup";
import { getBackupAlert } from "@/lib/backup-alert";
import { maskDestinationLabel, maskHostIn, maskHostsIn } from "@/lib/backup-label";
import { db } from "@/lib/db";
import { listJobRuns } from "@/lib/jobs";
import { SCHEDULED_JOBS } from "@/lib/maintenance";
import { requireAdminPage } from "@/lib/session";
import { getT } from "@/i18n/server";
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
  const masked = maskForView(status, backupDestinationsInfo(), jobs);
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
    />
  );
}

function maskForView(status: Awaited<ReturnType<typeof readStatus>>, destinations: ReturnType<typeof backupDestinationsInfo>, jobs: Awaited<ReturnType<typeof listJobRuns>>) {
  const external = Object.fromEntries(
    Object.entries(status.external ?? {}).map(([id, st]) => {
      const last = st?.last;
      return [id, last ? { ...st, last: { ...last, label: maskDestinationLabel(last.label), ...(last.error ? { error: maskHostIn(last.error, last.label) } : {}) } } : st];
    }),
  ) as typeof status.external;
  // El último error de las tareas programadas (la copia externa entre ellas) puede llevar el host de cualquier destino,
  // también de uno que ya no está configurado pero sigue en el estado guardado.
  const labels = [...destinations.external.map((d) => d.label), ...Object.values(status.external ?? {}).flatMap((st) => (st?.last?.label ? [st.last.label] : []))];
  return {
    jobs: jobs.map((j) => (j.lastError ? { ...j, lastError: maskHostsIn(j.lastError, labels) } : j)),
    status: { ...status, ...(status.external ? { external } : {}) },
    destinations: {
      ...destinations,
      external: destinations.external.map((d) => ({ ...d, label: maskDestinationLabel(d.label) })),
      errors: destinations.errors.map((e) => maskHostsIn(e, destinations.external.map((d) => d.label))),
    },
  };
}
