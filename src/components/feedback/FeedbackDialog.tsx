"use client";

import { Copy, Download, ExternalLink, ImageOff, Loader2 } from "lucide-react";
import { useContext, useEffect, useId, useState } from "react";
import { I18nContext } from "@/i18n/context";
import { useT } from "@/i18n/client";
import { bugReportFields, bugReportTextFits, bugReportUrl, describeBrowser, SECURITY_REPORT_URL, type BugReportFields, type InstallKind } from "@/lib/bug-report-core";
import { FEEDBACK_FIELDS, FEEDBACK_LIMITS, FEEDBACK_TEXT_MAX, screenshotFileName, type FeedbackError, type FeedbackKind, type FeedbackStatus } from "@/lib/feedback-core";
import { formatSize } from "@/lib/format-size";
import { copyText } from "../ui/clipboard";
import { cn } from "../ui/cn";
import { Modal } from "../ui/Modal";
import { useToast } from "../ui/Toast";
import { SESSION_EXPIRED } from "../ui/session-expired";
import { captureScreen } from "./capture";

// Valores fijados al compilar (next.config.ts): commit y tipo de build oficial («docker» o «railway»).
const COMMIT = process.env.NEXT_PUBLIC_GIT_COMMIT ?? "";
const INSTALL = (process.env.NEXT_PUBLIC_OFFICIAL_BUILD || null) as InstallKind | null;

type Shot = { blob: Blob; url: string };

/**
 * Diálogo «Informar de un error o enviar una sugerencia». Sin `githubReason` se envía en privado por email (ruta
 * /api/feedback); con él (la instalación no envía emails o el producto aún no tiene dirección) abre el formulario
 * público de GitHub con el texto y los datos técnicos, y ofrece descargar la captura para adjuntarla a mano. El motivo
 * importa: sin la dirección del producto no se culpa al correo de la instalación.
 */
export function FeedbackDialog({ githubReason, version, email, onClose }: {
  githubReason: FeedbackStatus["githubReason"];
  version: string;
  email: string;
  onClose: () => void;
}) {
  const t = useT();
  const toast = useToast();
  const { locale } = useContext(I18nContext);
  const ids = useId();
  const [kind, setKind] = useState<FeedbackKind>("bug");
  const [text, setText] = useState("");
  const [shot, setShot] = useState<Shot | null>(null);
  const [capturing, setCapturing] = useState(false);
  const [captureError, setCaptureError] = useState<string | null>(null);
  const [replyTo, setReplyTo] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fields] = useState<BugReportFields>(() => ({ version, commit: COMMIT, install: INSTALL, browser: describeBrowser(navigator.userAgent), language: locale }));
  const mail = githubReason === null;

  // La URL de la vista previa se libera al quitarla o al cerrar.
  useEffect(() => () => { if (shot) URL.revokeObjectURL(shot.url); }, [shot]);

  const labels: Record<string, string> = {
    version: t("Versión"),
    commit: t("Commit"),
    install: t("Instalación"),
    browser: t("Navegador y sistema"),
    language: t("Idioma"),
  };

  const toggleShot = async (on: boolean) => {
    setCaptureError(null);
    if (!on) return setShot(null);
    setCapturing(true);
    try {
      const blob = await captureScreen();
      setShot({ blob, url: URL.createObjectURL(blob) });
    } catch {
      setCaptureError(t("No se ha podido hacer la captura. Puedes enviarlo sin ella."));
    } finally {
      setCapturing(false);
    }
  };

  const errorText = (code: FeedbackError | undefined): string => {
    switch (code) {
      case "rate_user": return t("Ya has enviado {n} informes hoy. Vuelve a intentarlo mañana.", { n: FEEDBACK_LIMITS.user });
      case "rate_install": return t("Desde esta instalación ya se han enviado muchos informes hoy. Vuelve a intentarlo mañana.");
      case "too_big": return t("La captura es demasiado grande. Quítala o inténtalo con la ventana más pequeña.");
      case "bad_image": return t("La captura no es una imagen válida. Quítala y vuelve a hacerla.");
      case "outdated": return t("Actualiza a la última versión para informar de un error o enviar una sugerencia");
      case "unavailable": return t("Esta instalación ya no puede enviar informes por email.");
      case "empty": return t("Escribe qué ha pasado o qué te gustaría.");
      default: return t("No se ha podido enviar. Inténtalo de nuevo más tarde.");
    }
  };

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!mail || sending) return;
    if (!text.trim()) return setError(errorText("empty"));
    setSending(true);
    setError(null);
    const form = new FormData();
    form.set(FEEDBACK_FIELDS.kind, kind);
    form.set(FEEDBACK_FIELDS.text, text.trim());
    form.set(FEEDBACK_FIELDS.language, locale);
    if (replyTo) form.set(FEEDBACK_FIELDS.replyTo, "1");
    if (shot) form.set(FEEDBACK_FIELDS.screenshot, shot.blob, screenshotFileName(shot.blob.type));
    try {
      const res = await fetch("/api/feedback", { method: "POST", body: form });
      if (res.ok) {
        toast(kind === "bug" ? t("Gracias. Tu informe se ha enviado.") : t("Gracias. Tu sugerencia se ha enviado."));
        onClose();
        return;
      }
      if (res.status === 401) {
        toast(t(SESSION_EXPIRED), "error");
        return;
      }
      const body = (await res.json().catch(() => null)) as { error?: FeedbackError } | null;
      setError(errorText(body?.error));
    } catch {
      setError(t("Sin conexión: no se ha enviado. Inténtalo de nuevo cuando vuelva la conexión."));
    } finally {
      setSending(false);
    }
  };

  const textId = `${ids}-text`;
  const githubHref = bugReportUrl(fields, kind, text);
  // Un texto largo no cabe en la dirección del formulario y GitHub recibe solo el principio: se avisa antes, con un botón
  // para copiarlo entero, y el diálogo no se cierra al continuar.
  const truncated = !mail && !!text.trim() && !bugReportTextFits(fields, kind, text);
  const shotName = shot ? screenshotFileName(shot.blob.type) : "";

  return (
    <Modal
      open
      onClose={sending ? () => false : onClose}
      size="md"
      title={t("Informar de un error o enviar una sugerencia")}
      footer={
        <>
          <button type="button" className="btn-secondary" onClick={onClose} disabled={sending}>{t("Cancelar")}</button>
          {mail ? (
            <button type="submit" form={`${ids}-form`} className="btn-primary" disabled={sending || capturing || !text.trim()}>
              {sending && <Loader2 size={15} className="animate-spin" />} {sending ? t("Enviando…") : t("Enviar")}
            </button>
          ) : (
            <a href={githubHref} target="_blank" rel="noopener noreferrer" className={cn("btn-primary", !text.trim() && "pointer-events-none opacity-50")} aria-disabled={!text.trim() || undefined} onClick={(e) => {
                // Con captura o con el texto recortado, el diálogo se queda abierto para descargarla o copiarlo después.
                if (!text.trim()) e.preventDefault();
                else if (!shot && !truncated) onClose();
              }}>
              {t("Continuar en GitHub")} <ExternalLink size={14} />
            </a>
          )}
        </>
      }
    >
      <form id={`${ids}-form`} onSubmit={send} className="space-y-4 text-sm">
        <fieldset>
          <legend className="label">{t("Tipo")}</legend>
          <div className="flex flex-wrap gap-2">
            {(["bug", "idea"] as const).map((k) => (
              <label key={k} className={cn("flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-1.5", kind === k ? "border-brand-500 bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-100" : "border-slate-200 dark:border-slate-700")}>
                <input type="radio" name={`${ids}-kind`} value={k} checked={kind === k} onChange={() => setKind(k)} />
                {k === "bug" ? t("Informar de un error") : t("Enviar una sugerencia")}
              </label>
            ))}
          </div>
        </fieldset>

        <div>
          <label className="label" htmlFor={textId}>{kind === "bug" ? t("¿Qué ha pasado?") : t("¿Qué te gustaría?")}</label>
          <textarea
            id={textId}
            className="input min-h-28"
            value={text}
            maxLength={FEEDBACK_TEXT_MAX}
            onChange={(e) => setText(e.target.value)}
            placeholder={kind === "bug" ? t("Qué hacías, qué esperabas que pasara y qué pasó.") : t("Qué echas en falta o qué cambiarías, y para qué te serviría.")}
            required
            data-autofocus
          />
        </div>

        <div className="space-y-2">
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={!!shot || capturing} disabled={capturing || sending} onChange={(e) => void toggleShot(e.target.checked)} />
            {t("Incluir una captura de la pantalla")}
            {capturing && <Loader2 size={14} className="animate-spin text-slate-500" aria-label={t("Haciendo la captura…")} />}
          </label>
          {captureError && <p role="alert" className="text-xs text-red-600 dark:text-red-400">{captureError}</p>}
          {shot && (
            <div className="space-y-2 rounded-lg border border-slate-200 p-2 dark:border-slate-700">
              {/* eslint-disable-next-line @next/next/no-img-element -- vista previa de un blob local */}
              <img src={shot.url} alt={t("Vista previa de la captura")} className="max-h-48 w-full rounded object-contain object-left-top" data-feedback-preview="" />
              <div className="flex flex-wrap items-center gap-2">
                <button type="button" className="btn-secondary py-1 text-xs" onClick={() => void toggleShot(false)} disabled={sending}>
                  <ImageOff size={14} /> {t("Quitar la captura")}
                </button>
                {!mail && (
                  <a href={shot.url} download={shotName} className="btn-secondary py-1 text-xs">
                    <Download size={14} /> {t("Descargar la captura")}
                  </a>
                )}
                <span className="text-xs text-slate-500">{formatSize(shot.blob.size, locale === "en" ? "en-US" : "es-ES")}</span>
              </div>
              <p className="text-xs text-amber-700 dark:text-amber-300">
                {t("La captura puede contener datos de tu trabajo (nombres, tareas, comentarios). Revísala antes de enviarla y quítala si no quieres que se vean.")}
              </p>
            </div>
          )}
        </div>

        {mail && (
          <label className="flex items-start gap-2">
            <input type="checkbox" className="mt-0.5" checked={replyTo} onChange={(e) => setReplyTo(e.target.checked)} disabled={sending} />
            <span>
              {t("Incluir mi email para que me respondan")}
              {email && <span className="block text-xs text-slate-500">{email}</span>}
            </span>
          </label>
        )}

        <div>
          <p className="mb-1 text-xs text-slate-500">{mail ? t("Datos técnicos que se envían:") : t("Datos técnicos que se rellenan en GitHub:")}</p>
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 rounded-lg bg-slate-50 p-3 text-xs dark:bg-slate-800/60">
            {bugReportFields(fields).map(([k, v]) => (
              <div key={k} className="contents">
                <dt className="text-slate-500">{labels[k] ?? k}</dt>
                <dd className="min-w-0 break-all font-mono">{k === "commit" ? v.slice(0, 12) : v}</dd>
              </div>
            ))}
          </dl>
        </div>

        {mail ? (
          <p className="text-slate-600 dark:text-slate-300">
            {t("Se envía en privado por email al equipo de Pizarro, desde el servidor de correo de esta instalación (así que su dirección de envío se verá). Solo va lo que escribes, la captura si la incluyes, tu email si lo marcas y estos datos técnicos; nada más de tus proyectos ni de tu cuenta.")}
          </p>
        ) : (
          <div className="space-y-2 text-slate-600 dark:text-slate-300">
            <p>
              {githubReason === "no_mail"
                ? t("Esta instalación no puede enviarlo por email: se abrirá el formulario de Pizarro en GitHub con lo que has escrito y estos datos técnicos.")
                : t("Se abrirá el formulario de Pizarro en GitHub con lo que has escrito y estos datos técnicos.")}
            </p>
            <p>{t("Necesitas una cuenta de GitHub. La incidencia es pública: no incluyas datos personales ni capturas con información privada.")}</p>
            {shot && <p>{t("La captura no se adjunta sola: descárgala y, si no tiene información privada, añádela en GitHub.")}</p>}
            {truncated && (
              <div role="status" className="space-y-2 rounded-lg bg-amber-50 p-2 text-amber-800 dark:bg-amber-500/10 dark:text-amber-200">
                <p>{t("El texto es largo: GitHub solo recibirá el principio. Cópialo entero con este botón para pegarlo allí.")}</p>
                <button type="button" className="btn-secondary py-1 text-xs" onClick={async () => ((await copyText(text.trim())) ? toast(t("Texto copiado")) : toast(t("No se pudo copiar"), "error"))}>
                  <Copy size={14} /> {t("Copiar el texto")}
                </button>
              </div>
            )}
          </div>
        )}

        {error && <p role="alert" className="rounded-lg bg-red-50 p-2 text-red-700 dark:bg-red-500/10 dark:text-red-300">{error}</p>}

        <p className="text-xs text-slate-500">
          {t("¿Es un fallo de seguridad? No lo publiques:")}{" "}
          <a href={SECURITY_REPORT_URL} target="_blank" rel="noopener noreferrer" className="text-brand-600 hover:underline dark:text-brand-300">
            {t("infórmalo en privado")}
          </a>
          .
        </p>
      </form>
    </Modal>
  );
}
