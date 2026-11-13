"use client";

import { CloudUpload, Download, ShieldAlert, ShieldCheck } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { acceptBackupReduction, copyToExternalNow, createBackupNow, requestBackupDownload } from "@/actions/backups";
import { InfoTip } from "@/components/ui/InfoTip";
import { Modal } from "@/components/ui/Modal";
import { PasswordInput } from "@/components/ui/PasswordInput";
import { useToast } from "@/components/ui/Toast";
import { useIntlLocale, useT } from "@/i18n/client";
import { formatDate } from "@/lib/format";
import { formatSize } from "@/lib/format-size";
import { shrinkText, type BackupAlert } from "@/lib/backup-alert-core";
import type { BackupFileInfo, BackupRun, BackupStatus, ExternalRun, RestoreTestRun } from "@/lib/backup";
import type { BackupKeyDiagnosis } from "@/lib/backup-core";
import type { DestinationId } from "@/lib/backup-dest";
import type { JobRunInfo } from "@/lib/jobs";
import { useActionTransition } from "@/components/useActionTransition";

/** Tamaño con la coma decimal del idioma («2,3 MB»). */
const sizeText = (bytes: number, locale: string): string => formatSize(Math.max(bytes, 1024), locale);

/** Nombre legible de cada tarea de mantenimiento (las claves están en lib/maintenance.ts). */
function jobLabel(t: (s: string) => string, name: string): string {
  switch (name) {
    case "nonImageCopies": return t("Copias de ficheros no imagen antiguas");
    case "undo": return t("Deshacer antiguo");
    case "documentsTrashPurge": return t("Papelera de documentos (una vez al día)");
    case "notifications": return t("Avisos leídos antiguos");
    case "authData": return t("Enlaces y dispositivos caducados");
    case "taskHistory": return t("Historial de tareas antiguo");
    case "orphanFiles": return t("Ficheros huérfanos (una vez al día)");
    case "backup": return t("Copia diaria");
    case "backupExternal": return t("Copia a destino externo");
    case "backupAlert": return t("Aviso de copia atrasada");
    case "restoreTest": return t("Prueba de restauración mensual");
    case "periodicMail": return t("Resúmenes e informes por email");
    case "transferJobs": return t("Archivos de exportación de proyectos caducados");
    case "waitingReminders": return t("Recordatorios de tareas en espera");
    case "releaseResume": return t("Reanudar copias de adjuntos de releases");
    default: return name;
  }
}

export interface DestinationsInfo {
  local: { label: string; files: boolean };
  external: { id: DestinationId; label: string }[];
  errors: string[];
}

/** Explica qué se ha detectado en una BACKUP_KEY no válida, sin mostrar su valor. */
function keyProblemText(p: BackupKeyDiagnosis | null, t: (s: string, v?: Record<string, string | number>) => string): string {
  const found: string[] = [];
  if (p?.kind === "hex") found.push(t("parece hexadecimal de {n} caracteres (se necesitan exactamente 64)", { n: p.chars }));
  else if (p?.kind === "base64") found.push(t("parece base64 que decodifica a {n} bytes (se necesitan 32)", { n: p.bytes }));
  else if (p?.kind === "other") found.push(t("tiene {n} caracteres y no es ni base64 ni hexadecimal", { n: p.chars }));
  else found.push(t("está vacía una vez quitadas las comillas y los espacios"));
  if (p?.quoted) found.push(t("tenía comillas alrededor (se ignoran, pero revisa que no falte nada)"));
  if (p?.spaces) found.push(t("contiene espacios o saltos de línea en medio"));
  return t("BACKUP_KEY no es válida: {found}. Debe ser de 32 bytes en base64 (openssl rand -base64 32) o 64 caracteres hexadecimales (openssl rand -hex 32). Las copias están desactivadas.", { found: found.join("; ") });
}

/** Panel «Copias de seguridad»: estado de la última copia, de la copia externa y de la última prueba de restauración. */
export function BackupsAdmin({ keyState, keyProblem, alert, status, files, canUseCode, jobs, destinations, externalRunning, paused = false }: {
  keyState: "ok" | "missing" | "invalid";
  keyProblem: BackupKeyDiagnosis | null;
  status: BackupStatus;
  alert: BackupAlert;
  files: BackupFileInfo[];
  canUseCode: boolean;
  jobs: JobRunInfo[];
  destinations: DestinationsInfo;
  externalRunning: boolean;
  /** BACKUP_PAUSE=1: las tareas automáticas de copia están detenidas. */
  paused?: boolean;
}) {
  const t = useT();
  const locale = useIntlLocale();
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useActionTransition();
  const enabled = keyState === "ok";
  // Descarga protegida: se pide la contraseña (o un código de la app) y solo entonces se pide el fichero con un token de un solo uso.
  const [dlOpen, setDlOpen] = useState(false);
  const [useCode, setUseCode] = useState(false);
  const [secret, setSecret] = useState("");
  const [dlError, setDlError] = useState<string | null>(null);
  const closeDl = () => (setDlOpen(false), setUseCode(false), setSecret(""), setDlError(null));
  const download = () =>
    start(async () => {
      setDlError(null);
      const res = await requestBackupDownload(useCode ? { code: secret } : { password: secret });
      if (!res.ok) return setDlError(res.error);
      closeDl();
      // La descarga es una navegación a la ruta con el token de un solo uso (válido 60 s).
      const a = document.createElement("a");
      a.href = `/api/admin/backups/latest?token=${encodeURIComponent(res.data.token)}`;
      a.download = "";
      a.click();
    });

  const copyExternal = () =>
    start(async () => {
      const res = await copyToExternalNow();
      if (res.ok) toast(t("Copia a destino externo iniciada. Recarga la página en unos minutos para ver el resultado."));
      else toast(res.error, "error");
      router.refresh();
    });

  // «La reducción es correcta»: pide una segunda pulsación (la copia buena deja de conservarse siempre).
  const [confirmShrink, setConfirmShrink] = useState(false);
  // Con la copia del aviso que se ve: si ha llegado otra entretanto, el servidor no confirma y pide revisarlo.
  const acceptShrink = (seen: { stem: string; goodStem: string }) =>
    start(async () => {
      const res = await acceptBackupReduction(seen);
      if (res.ok) toast(t("Reducción confirmada. La copia anterior se borrará cuando le toque por la retención."));
      else toast(res.error, "error");
      setConfirmShrink(false);
      router.refresh();
    });

  const create = () =>
    start(async () => {
      const res = await createBackupNow();
      if (res.ok) toast(t("Copia creada: {file}", { file: res.data.file }));
      else toast(res.error, "error");
      router.refresh();
    });

  const run = (r: (BackupRun & Partial<RestoreTestRun>) | undefined, what: "backup" | "test") => {
    if (!r) return <p className="text-sm text-slate-500">{what === "backup" ? t("Aún no se ha hecho ninguna copia.") : t("Aún no se ha hecho ninguna prueba de restauración.")}</p>;
    return (
      <div className="text-sm">
        <p className="flex items-center gap-2">
          <span className={r.ok ? "badge bg-emerald-50 text-emerald-700 ring-emerald-500/20" : "badge bg-red-50 text-red-700 ring-red-500/20"}>{r.ok ? t("Correcta") : t("Con error")}</span>
          <span>{formatDate(r.at, "dateTime", locale)}</span>
        </p>
        {r.ok ? (
          <p className="mt-1 text-slate-500">
            {r.file} · {r.rows} {t("filas")} · {r.tables} {t("tablas")}
            {r.bytes ? ` · ${sizeText(r.bytes, locale)}` : ""}
            {r.files !== undefined && ` · ${r.files === 1 ? t("1 fichero") : t("{n} ficheros", { n: r.files })}${r.filesBytes ? ` (${sizeText(r.filesBytes, locale)})` : ""}`}
            {what === "backup" && r.filesNew ? ` · ${r.filesNew === 1 ? t("1 nuevo") : t("{n} nuevos", { n: r.filesNew })}` : ""}
          </p>
        ) : (
          <p className="mt-1 break-words text-red-600 dark:text-red-400">{r.error}</p>
        )}
      </div>
    );
  };

  const external = (r: ExternalRun | undefined, lastOkAt: string | undefined) => {
    if (!r) return <p className="text-sm text-slate-500">{t("Aún no se ha subido ninguna copia.")}</p>;
    return (
      <div className="text-sm">
        <p className="flex flex-wrap items-center gap-2">
          <span className={r.ok ? "badge bg-emerald-50 text-emerald-700 ring-emerald-500/20" : "badge bg-red-50 text-red-700 ring-red-500/20"}>{r.ok ? t("Correcta") : t("Con error")}</span>
          <span>{formatDate(r.at, "dateTime", locale)}</span>
        </p>
        {r.ok ? (
          <p className="mt-1 text-slate-500">
            {r.file} · {r.uploaded === 1 ? t("1 fichero nuevo") : t("{n} ficheros nuevos", { n: r.uploaded ?? 0 })} · {r.skipped === 1 ? t("1 ya estaba") : t("{n} ya estaban", { n: r.skipped ?? 0 })}
            {r.bytes ? ` · ${sizeText(r.bytes, locale)}` : ""}
          </p>
        ) : (
          <p className="mt-1 break-words text-red-600 dark:text-red-400">{r.error}</p>
        )}
        {r.warning && <p className="mt-1 break-words text-amber-700 dark:text-amber-300">{r.warning}</p>}
        {!r.ok && lastOkAt && <p className="mt-1 text-slate-500">{t("Última subida correcta: {date}", { date: formatDate(lastOkAt, "dateTime", locale) })}</p>}
      </div>
    );
  };

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">{t("Copias de seguridad")}</h2>
        <p className="flex items-center gap-1 text-sm text-slate-500">
          {t("Cada día, la base de datos y los ficheros, cifrados. Se conservan 14 diarias y 6 mensuales.")}
          <InfoTip topic={t("Copias de seguridad")}>{t("Comprimidas y cifradas (AES-256) en la carpeta backups del volumen y, si está configurado, en un destino externo. Los ficheros se guardan una sola vez: cada copia solo añade los nuevos.")}</InfoTip>
        </p>
      </div>

      {alert.active && alert.reason === "shrunk" && alert.shrink ? (
        <div role="alert" className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200">
          <ShieldAlert size={18} className="mt-0.5 shrink-0" />
          <div className="min-w-0 space-y-1">
            <p className="font-semibold">{t("La última copia es mucho menor que la anterior")}</p>
            <p>{shrinkText(alert.shrink, t, (iso) => formatDate(iso, "dateTime", locale))}</p>
            <p>
              {t("¿Se ha perdido la base de datos o el volumen? La retención conserva la última copia buena ({stem}) aunque ya le tocara borrarla. Para recuperarla, sigue los pasos de restauración de docs/INSTALL.md con ese nombre.", { stem: alert.shrink.goodStem })}
            </p>
            <p>{t("Si has borrado datos a propósito, confírmalo: el aviso desaparece y la copia anterior se borrará cuando le toque.")}</p>
            <div className="flex flex-wrap gap-2 pt-1">
              {confirmShrink ? (
                <>
                  <button type="button" className="btn-primary" onClick={() => acceptShrink({ stem: alert.shrink!.stem, goodStem: alert.shrink!.goodStem })} disabled={pending}>{t("Sí, la reducción es correcta")}</button>
                  <button type="button" className="btn-secondary" onClick={() => setConfirmShrink(false)} disabled={pending}>{t("Cancelar")}</button>
                </>
              ) : (
                <button type="button" className="btn-secondary" onClick={() => setConfirmShrink(true)}>{t("La reducción es correcta")}</button>
              )}
            </div>
          </div>
        </div>
      ) : alert.active && (
        <div role="alert" className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200">
          <ShieldAlert size={18} className="mt-0.5 shrink-0" />
          <div>
            <p className="font-semibold">{alert.reason === "externalNone" || alert.reason === "externalStale" ? t("La copia externa está atrasada") : t("La copia de seguridad está atrasada")}</p>
            <p>
              {alert.reason === "externalNone"
                ? t("Todavía no se ha subido ninguna copia al destino externo configurado.")
                : alert.reason === "externalStale" && alert.lastAt
                  ? t("La última copia subida correctamente al destino externo es del {date}, hace más de 48 horas.", { date: formatDate(alert.lastAt, "dateTime", locale) })
                  : alert.lastAt
                    ? t("La última copia correcta es del {date}, hace más de 48 horas.", { date: formatDate(alert.lastAt, "dateTime", locale) })
                    : t("Todavía no hay ninguna copia correcta, aunque BACKUP_KEY está configurada.")}
            </p>
            <p className="mt-1">{t("Revisa los Logs (categoría sistema) por si hay algún error y prueba «Crear copia ahora».")}</p>
          </div>
        </div>
      )}

      {enabled && paused ? (
        <p role="alert" className="card flex items-start gap-2 p-3 text-sm text-amber-700 dark:text-amber-300">
          <ShieldAlert size={16} className="mt-0.5 shrink-0" />
          <span>{t("Copias automáticas en pausa (BACKUP_PAUSE=1): no se hacen la copia diaria, la subida al destino externo ni la prueba de restauración. Quita la variable cuando termines de restaurar.")}</span>
        </p>
      ) : enabled ? (
        <p className="flex items-center gap-2 text-sm text-emerald-700 dark:text-emerald-400">
          <ShieldCheck size={16} /> {t("Copias automáticas activadas.")}
        </p>
      ) : (
        <p role="alert" className="card flex items-start gap-2 p-3 text-sm text-amber-700 dark:text-amber-300">
          <ShieldAlert size={16} className="mt-0.5 shrink-0" />
          <span>
            {keyState === "invalid"
              ? keyProblemText(keyProblem, t)
              : t("Las copias de seguridad están desactivadas: define la variable BACKUP_KEY (openssl rand -base64 32) y reinicia.")}
          </span>
        </p>
      )}

      <section className="card space-y-2 p-4">
        <h3 className="text-sm font-semibold">{t("Última copia")}</h3>
        {run(status.lastBackup, "backup")}
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <button className="btn-primary" onClick={create} disabled={!enabled || pending}>
            {pending ? t("Creando…") : t("Crear copia ahora")}
          </button>
          {files.length > 0 && (
            <>
              <button type="button" className="btn-secondary" onClick={() => setDlOpen(true)}>
                <Download size={16} /> {t("Descargar")}
              </button>
              <InfoTip topic={t("Descargar")}>{t("Baja solo la base de datos, cifrada: se abre con la BACKUP_KEY. Para restaurar una copia completa se usa node dist/restore.mjs (pasos en docs/INSTALL.md).")}</InfoTip>
            </>
          )}
        </div>
        <p className="text-xs text-slate-500">
          {destinations.local.files
            ? t("Destino local: {dir}, con los ficheros.", { dir: destinations.local.label })
            : t("Destino local: {dir}, solo la base de datos (BACKUP_LOCAL_FILES=0: los ficheros van solo al destino externo).", { dir: destinations.local.label })}
        </p>
      </section>

      <section className="card space-y-2 p-4">
        <h3 className="flex items-center gap-1 text-sm font-semibold">
          {t("Destino externo")}
          <InfoTip topic={t("Destino externo")}>{t("Tras cada copia diaria se sube a cada destino lo que aún no tenga (si se corta, sigue a la hora siguiente). Se avisa si la última subida correcta tiene más de 48 horas.")}</InfoTip>
        </h3>
        {destinations.errors.map((e) => (
          <p key={e} role="alert" className="break-words text-sm text-red-600 dark:text-red-400">{e}</p>
        ))}
        {destinations.external.length === 0 ? (
          destinations.errors.length === 0 && (
            <p className="text-sm text-amber-700 dark:text-amber-300">
              {t("Sin destino externo: las copias están en el mismo disco que protegen. Configura un almacenamiento S3 compatible (BACKUP_S3_*) o una carpeta montada (BACKUP_EXTERNAL_DIR); ver docs/INSTALL.md.")}
            </p>
          )
        ) : (
          <ul className="space-y-3">
            {destinations.external.map((d) => (
              <li key={d.id}>
                <p className="text-sm font-medium break-all">{d.label}</p>
                {external(status.external?.[d.id]?.last, status.external?.[d.id]?.lastOkAt)}
              </li>
            ))}
          </ul>
        )}
        {destinations.external.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <button type="button" className="btn-secondary" onClick={copyExternal} disabled={!enabled || pending || externalRunning}>
              <CloudUpload size={16} /> {externalRunning ? t("Copiando…") : t("Copiar ahora a destino externo")}
            </button>
          </div>
        )}
      </section>

      <section className="card space-y-2 p-4">
        <h3 className="flex items-center gap-1 text-sm font-semibold">
          {t("Última prueba de restauración")}
          <InfoTip topic={t("Última prueba de restauración")}>{t("Cada mes se restaura la última copia en una base de datos temporal (o, si no se puede crear, se descifra y se comprueba entera) y se comprueba que cada destino tiene todos sus ficheros.")}</InfoTip>
        </h3>
        {run(status.lastRestoreTest, "test")}
        {status.lastRestoreTest?.ok && (
          <p className="text-xs text-slate-500">
            {status.lastRestoreTest.mode === "database"
              ? t("Restaurada de verdad en una base de datos temporal, que después se borra.")
              : status.lastRestoreTest.limit === "createdb"
                ? t("Solo se descifró y se comprobó la copia: el usuario de la base de datos no puede crear bases de datos para restaurarla en una temporal.")
                : t("Solo se descifró y se comprobó la copia.")}
            {status.lastRestoreTest.objectsChecked !== undefined && ` ${t("Ficheros comprobados en los destinos: {n} (descifrados de muestra: {m}).", { n: status.lastRestoreTest.objectsChecked, m: status.lastRestoreTest.objectsSampled ?? 0 })}`}
          </p>
        )}
      </section>

      {files.length > 0 && (
        <section className="card p-4">
          <h3 className="mb-2 text-sm font-semibold">{t("Copias guardadas ({n})", { n: files.length })}</h3>
          <ul className="divide-y divide-slate-200 text-sm dark:divide-slate-800">
            {files.map((f) => (
              <li key={f.name} className="flex justify-between gap-3 py-1.5">
                <span className="truncate">{f.name}</span>
                <span className="shrink-0 text-slate-500">{sizeText(f.bytes, locale)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="card p-4">
        <h3 className="mb-2 flex items-center gap-1 text-sm font-semibold">
          {t("Tareas de mantenimiento")}
          <InfoTip topic={t("Tareas de mantenimiento")}>{t("Se ejecutan cada hora, en un solo proceso a la vez. Aquí sale la última ejecución de cada una.")}</InfoTip>
        </h3>
        {jobs.length === 0 ? (
          <p className="text-sm text-slate-500">{t("Aún no se ha ejecutado ninguna (la primera pasada es un minuto después de arrancar).")}</p>
        ) : (
          <ul className="divide-y divide-slate-200 text-sm dark:divide-slate-800">
            {jobs.map((j) => (
              <li key={j.name} className="py-1.5">
                <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                  <span>{jobLabel(t, j.name)}</span>
                  <span className="flex items-center gap-2 text-slate-500">
                    {j.lastStartedAt && formatDate(j.lastStartedAt, "dateTimeShort", locale)}
                    <span className={j.lastOk === false ? "badge bg-red-50 text-red-700 ring-red-500/20" : j.lastOk ? "badge bg-emerald-50 text-emerald-700 ring-emerald-500/20" : "badge bg-slate-50 text-slate-600 ring-slate-500/20"}>
                      {j.lastOk === false ? t("Con error") : j.lastOk ? t("Correcta") : t("En curso")}
                    </span>
                  </span>
                </div>
                {j.lastOk === false && j.lastError && <p className="mt-0.5 break-words text-xs text-red-600 dark:text-red-400">{j.lastError}</p>}
              </li>
            ))}
          </ul>
        )}
      </section>

      <Modal open={dlOpen} onClose={closeDl} size="sm" title={t("Confirma tu identidad")}>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            download();
          }}
        >
          <p className="text-sm text-slate-600 dark:text-slate-300">
            {useCode ? t("Escribe el código de 6 dígitos de tu app de autenticación para descargar la copia.") : t("Por seguridad, escribe tu contraseña para descargar la copia.")}
          </p>
          <div>
            <label className="label" htmlFor="backup-secret">{useCode ? t("Código de verificación") : t("Contraseña")}</label>
            {useCode ? (
              <input id="backup-secret" className="input" inputMode="numeric" autoComplete="one-time-code" maxLength={8} required autoFocus value={secret} onChange={(e) => setSecret(e.target.value)} />
            ) : (
              <PasswordInput id="backup-secret" className="input" autoComplete="current-password" required autoFocus value={secret} onChange={(e) => setSecret(e.target.value)} />
            )}
          </div>
          {dlError && <p role="alert" className="text-sm text-red-600 dark:text-red-400">{dlError}</p>}
          {canUseCode && (
            <button type="button" className="text-sm text-brand-700 hover:underline dark:text-brand-300" onClick={() => (setUseCode(!useCode), setSecret(""), setDlError(null))}>
              {useCode ? t("Usar mi contraseña") : t("Entro con Google y no tengo contraseña: usar un código de mi app")}
            </button>
          )}
          <div className="flex justify-end gap-2">
            <button type="button" className="btn-ghost" onClick={closeDl}>{t("Cancelar")}</button>
            <button className="btn-primary" disabled={pending || !secret}>{pending ? t("Comprobando…") : t("Descargar")}</button>
          </div>
        </form>
      </Modal>

    </div>
  );
}
