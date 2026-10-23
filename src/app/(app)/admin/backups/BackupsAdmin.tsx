"use client";

import { Download, ShieldAlert, ShieldCheck } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { createBackupNow, requestBackupDownload } from "@/actions/backups";
import { Modal } from "@/components/ui/Modal";
import { PasswordInput } from "@/components/ui/PasswordInput";
import { useToast } from "@/components/ui/Toast";
import { useIntlLocale, useT } from "@/i18n/client";
import { formatDate } from "@/lib/format";
import type { BackupFileInfo, BackupRun, BackupStatus } from "@/lib/backup";

function kb(bytes: number): string {
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/** Panel «Copias de seguridad»: estado de la última copia y de la última prueba de restauración. */
export function BackupsAdmin({ keyState, status, files, canUseCode }: { keyState: "ok" | "missing" | "invalid"; status: BackupStatus; files: BackupFileInfo[]; canUseCode: boolean }) {
  const t = useT();
  const locale = useIntlLocale();
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
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

  const create = () =>
    start(async () => {
      const res = await createBackupNow();
      if (res.ok) toast(t("Copia creada: {file}", { file: res.data.file }));
      else toast(res.error, "error");
      router.refresh();
    });

  const run = (r: BackupRun | undefined, what: "backup" | "test") => {
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
            {r.bytes ? ` · ${kb(r.bytes)}` : ""}
          </p>
        ) : (
          <p className="mt-1 break-words text-red-600 dark:text-red-400">{r.error}</p>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">{t("Copias de seguridad")}</h2>
        <p className="text-sm text-slate-500">
          {t("Cada día se exporta la base de datos, comprimida y cifrada (AES-256), a la carpeta backups del volumen. Se conservan las últimas 14 diarias y 6 mensuales.")}
        </p>
      </div>

      {enabled ? (
        <p className="flex items-center gap-2 text-sm text-emerald-700 dark:text-emerald-400">
          <ShieldCheck size={16} /> {t("Copias automáticas activadas.")}
        </p>
      ) : (
        <p role="alert" className="card flex items-start gap-2 p-3 text-sm text-amber-700 dark:text-amber-300">
          <ShieldAlert size={16} className="mt-0.5 shrink-0" />
          <span>
            {keyState === "invalid"
              ? t("BACKUP_KEY no es válida: debe ser una clave de 32 bytes en base64 (openssl rand -base64 32). Las copias están desactivadas.")
              : t("Las copias de seguridad están desactivadas: define la variable BACKUP_KEY (openssl rand -base64 32) y reinicia.")}
          </span>
        </p>
      )}

      <section className="card space-y-2 p-4">
        <h3 className="text-sm font-semibold">{t("Última copia")}</h3>
        {run(status.lastBackup, "backup")}
        <div className="flex flex-wrap gap-2 pt-1">
          <button className="btn-primary" onClick={create} disabled={!enabled || pending}>
            {pending ? t("Creando…") : t("Crear copia ahora")}
          </button>
          {files.length > 0 && (
            <button type="button" className="btn-secondary" onClick={() => setDlOpen(true)}>
              <Download size={16} /> {t("Descargar")}
            </button>
          )}
        </div>
        <p className="text-xs text-slate-500">{t("El fichero descargado está cifrado: solo se abre con la BACKUP_KEY. Para restaurarlo, mira el README (scripts/restore-backup.ts).")}</p>
      </section>

      <section className="card space-y-2 p-4">
        <h3 className="text-sm font-semibold">{t("Última prueba de restauración")}</h3>
        {run(status.lastRestoreTest, "test")}
        <p className="text-xs text-slate-500">{t("Cada mes se descifra la última copia y se comprueba que es íntegra y que las filas coinciden con el manifiesto.")}</p>
      </section>

      {files.length > 0 && (
        <section className="card p-4">
          <h3 className="mb-2 text-sm font-semibold">{t("Copias guardadas ({n})", { n: files.length })}</h3>
          <ul className="divide-y divide-slate-200 text-sm dark:divide-slate-800">
            {files.map((f) => (
              <li key={f.name} className="flex justify-between gap-3 py-1.5">
                <span className="truncate">{f.name}</span>
                <span className="shrink-0 text-slate-500">{kb(f.bytes)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

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

      <p className="text-xs text-slate-500">{t("Los adjuntos ya son ficheros del mismo volumen: activa también las copias (snapshots) del volumen en Railway para protegerlos.")}</p>
    </div>
  );
}
