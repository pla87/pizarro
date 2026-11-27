"use client";

import { useId, useMemo, useState } from "react";
import { Clock, Copy, ExternalLink, Globe, Link2, Mail } from "lucide-react";
import { setColumnShareOut } from "@/actions/columns";
import { generateShareWeb, getShareLink, revokeShareLink, setShareExpiry } from "@/actions/share-out";
import { compareTaskOrder } from "@/lib/positions";
import { DEFAULT_SHARE_EXPIRY_DAYS, nextShareExpiry, shareExpiryLabel, shareHasUnpublished, shareMailto, shareStateText, type BoardShareInfo } from "@/lib/share-out-board";
import type { BoardColumn } from "@/lib/types";
import { useIntlLocale, useT } from "@/i18n/client";
import { cn } from "../ui/cn";
import { copyText } from "../ui/clipboard";
import { useConfirm } from "../ui/ConfirmDialog";
import { Modal } from "../ui/Modal";
import { useToast } from "../ui/Toast";
import { OFF } from "./ColumnActionButton";
import { useBoard, useTasks } from "./context";

// Columna «Compartir fuera» (lib/share-out*.ts): sus tareas se publican en una página sin cuenta (/x/<token>) para alguien
// de fuera. Aquí, la marca de la cabecera, el pie con «Generar web» / «Actualizar web», el aviso de lo que se publica y el
// selector de caducidad, y el diálogo con la dirección. La dirección la da el servidor (guarda el token cifrado) a
// cualquiera que pueda editar el proyecto, al generar o actualizar y con el botón del enlace; el navegador no la guarda.

function useDay() {
  const locale = useIntlLocale();
  return (iso: string) => new Date(iso).toLocaleDateString(locale, { day: "numeric", month: "short", year: "numeric" });
}

/** Marca discreta de la cabecera: hay enlace activo (y hasta cuándo), caducó o aún no se ha generado. */
export function ShareBadge({ info }: { info: BoardShareInfo | null | undefined }) {
  const t = useT();
  const day = useDay();
  const revoked = useRevokedLine(info);
  if (!info) return null;
  const s = shareStateText(info);
  const text = revoked ?? (s.date ? t(s.key, { date: day(s.date) }) : t(s.key));
  return (
    <span
      data-share-badge={info.state}
      role="img"
      aria-label={t("Compartir fuera: {state}", { state: text })}
      title={t("Compartir fuera: {state}", { state: text })}
      className={cn("inline-flex shrink-0 items-center", info.state === "active" ? "text-emerald-600 dark:text-emerald-400" : "text-slate-400 dark:text-slate-500")}
    >
      <Globe size={13} aria-hidden />
    </span>
  );
}

/**
 * Elegir y dejar «Compartir fuera» desde el submenú del rol. `pick`: convierte la columna. `leave`: antes de darle otro
 * rol, si su enlace está activo, confirma que dejará de funcionar (y no se puede deshacer).
 */
export function useShareRole(column: BoardColumn): { pick: () => void; leave: () => Promise<boolean> } {
  const t = useT();
  const toast = useToast();
  const confirm = useConfirm();
  const { track, refresh } = useBoard();
  return {
    pick: () => void track(setColumnShareOut(column.id)).then((res) => {
      if (!res.ok) toast(res.error, "error");
      refresh();
    }),
    leave: async () => column.share?.state !== "active" || confirm({
      title: t("Dejar de compartir"),
      message: t("La web de «{name}» dejará de funcionar al momento y no se puede deshacer. ¿Seguir?", { name: column.name }),
      confirmLabel: t("Dejar de compartir"),
      danger: true,
    }),
  };
}

/** «Enlace revocado por <nombre> el <fecha>» (si se sabe quién), para el pie y el diálogo. */
function useRevokedLine(info: BoardShareInfo | null | undefined): string | null {
  const t = useT();
  const day = useDay();
  if (!info || info.state !== "ended" || !info.revoked || !info.revokedBy || !info.endsAt) return null;
  return t("Enlace revocado por {name} el {date}", { name: info.revokedBy, date: day(info.endsAt) });
}

/** Lo que enseña el diálogo: la dirección (o `lost` si no se puede recuperar) y, tras generar, cuántas se publicaron. */
interface DialogState {
  url: string | null;
  lost: boolean;
  published?: number;
  left?: number;
}

/**
 * Pie de la columna: «Generar web» / «Actualizar web» y el botón del enlace, el aviso de cambios sin publicar (o el motivo
 * si la columna está vacía) y la caducidad.
 */
export function ShareFooter({ column }: { column: BoardColumn }) {
  const t = useT();
  const toast = useToast();
  const { track, setColumns, columns } = useBoard();
  const tasks = useTasks();
  const info = column.share ?? null;
  const [busy, setBusy] = useState(false);
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const days = info?.expiryDays ?? DEFAULT_SHARE_EXPIRY_DAYS;
  const active = info?.state === "active";
  // Las tareas de ahora (en el orden de la columna, las fijas incluidas): lo que se publicaría.
  const ids = useMemo(() => tasks.filter((x) => x.columnId === column.id).sort(compareTaskOrder).map((x) => x.id), [tasks, column.id]);
  const empty = ids.length === 0;
  // Con el enlace activo, la columna vacía sí se puede actualizar (despublica); sin él no hay nada que publicar.
  const off = empty && !active;
  // Las publicadas que ahora están en una columna terminada no cuentan como quitadas: la web las sigue leyendo.
  const doneIds = useMemo(() => {
    const doneCols = new Set(columns.filter((c) => c.isDone).map((c) => c.id));
    return new Set(tasks.filter((x) => doneCols.has(x.columnId)).map((x) => x.id));
  }, [tasks, columns]);
  const unpublished = info !== null && shareHasUnpublished(info, ids, doneIds);
  const reasonId = useId();
  const revokedLine = useRevokedLine(info);
  const apply = (next: BoardShareInfo) => setColumns((cols) => cols.map((c) => (c.id === column.id ? { ...c, share: next } : c)));

  const generate = async (fresh = false) => {
    if (busy || off) return;
    setBusy(true);
    // `track` no lanza: si la acción lanza (sin red), devuelve el fallo.
    const res = await track(generateShareWeb(column.id, { fresh }));
    setBusy(false);
    if (!res.ok) return toast(res.error, "error");
    apply(res.data.info);
    setDialog({ url: res.data.url, lost: res.data.lost, published: res.data.published, left: res.data.left });
  };

  // El botón del enlace: la dirección del enlace activo, la haya generado quien la haya generado.
  const openLink = async () => {
    if (busy) return;
    setBusy(true);
    const res = await track(getShareLink(column.id));
    setBusy(false);
    if (!res.ok) return toast(res.error, "error");
    apply(res.data.info);
    setDialog({ url: res.data.url, lost: res.data.lost });
  };

  const cycle = async () => {
    const next = nextShareExpiry(days);
    if (info) apply({ ...info, expiryDays: next });
    const res = await track(setShareExpiry(column.id, next));
    if (!res.ok) {
      if (info) apply(info);
      toast(res.error, "error");
    } else apply(res.data);
  };

  const label = shareExpiryLabel(days);
  const noTasks = t("No hay tareas en «{name}»", { name: column.name });
  return (
    <div className="space-y-1.5 border-t border-slate-200 px-2 pt-2 pb-2 dark:border-slate-700/70" data-share-footer>
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          className={cn("btn-primary min-w-0 flex-1 px-2 py-1.5 aria-busy:cursor-progress", OFF)}
          aria-busy={busy || undefined}
          aria-disabled={off || undefined}
          aria-describedby={off ? reasonId : undefined}
          title={off ? noTasks : undefined}
          onClick={off ? undefined : () => void generate()}
          data-share-generate
        >
          <Globe size={15} aria-hidden /> <span className="truncate">{active ? t("Actualizar web") : t("Generar web")}</span>
        </button>
        {active && (
          <button type="button" className="btn-primary shrink-0 px-2.5 py-1.5" onClick={() => void openLink()} aria-label={t("Link: enlace de la web")} title={t("Enlace de la web")} data-share-link>
            <Link2 size={15} aria-hidden /> {t("Link")}
          </button>
        )}
      </div>
      {off && <p id={reasonId} className="text-center text-xs text-slate-500 dark:text-slate-400" data-share-empty>{noTasks}</p>}
      {unpublished && <p className="text-xs leading-snug font-medium text-amber-700 dark:text-amber-400" role="status" data-share-unpublished>{t("Hay cambios sin publicar: pulsa «Actualizar web»")}</p>}
      {!active && revokedLine && <p className="text-xs leading-snug text-slate-600 dark:text-slate-400" data-share-revoked>{revokedLine}</p>}
      <p
        className="text-[11px] leading-snug text-slate-600 dark:text-slate-400"
        title={t("Se publican la descripción, las subtareas, los comentarios y los adjuntos de estas tareas; los adjuntos se podrán descargar.")}
      >
        {t("Se publica todo el contenido de las tareas.")}
      </p>
      {/* Caducidad: un botón que rota 7 días / 1 mes / 3 meses sin uso. */}
      <button
        type="button"
        data-share-expiry={days}
        onClick={() => void cycle()}
        aria-label={t("Caduca tras {label} sin uso: pulsa para cambiarlo", { label: t(label) })}
        title={t("Caduca tras {label} sin uso: pulsa para cambiarlo", { label: t(label) })}
        className="btn-secondary w-full justify-center px-2 py-1 text-xs"
      >
        <Clock size={13} aria-hidden /> {t("Caduca tras {label} sin uso", { label: t(label) })}
      </button>
      {dialog && <ShareDialog column={column} state={dialog} onClose={() => setDialog(null)} onFresh={() => void generate(true)} onRevoked={(next) => { apply(next); setDialog(null); }} />}
    </div>
  );
}

/**
 * Diálogo tras «Generar web» / «Actualizar web» (o desde el botón del enlace). De arriba abajo: lo publicado, la dirección
 * destacada con «Copiar», «Abrir» (otra pestaña) y «Enviar por email»; la caducidad como línea secundaria y, apartado
 * abajo, «Revocar enlace» (con confirmación). Si no se puede recuperar la dirección (`lost`: el enlace es de antes de
 * guardarla, o cambió la clave de cifrado sin rotarla), lo explica y ofrece crear un enlace nuevo, con confirmación.
 */
function ShareDialog({ column, state, onClose, onFresh, onRevoked }: {
  column: BoardColumn;
  state: DialogState;
  onClose: () => void;
  onFresh: () => void;
  onRevoked: (info: BoardShareInfo) => void;
}) {
  const t = useT();
  const toast = useToast();
  const confirm = useConfirm();
  const day = useDay();
  const { track } = useBoard();
  const info = column.share;
  const until = info?.state === "active" && info.endsAt ? day(info.endsAt) : null;
  const revokedLine = useRevokedLine(info);
  const url = state.url;

  const copy = async () => {
    if (!url) return;
    const ok = await copyText(url);
    toast(ok ? t("Enlace copiado") : t("No se ha podido copiar al portapapeles."), ok ? "success" : "error");
  };
  const mailto = url
    ? shareMailto(
      t("Tareas de «{name}»", { name: column.name }),
      t("Hola:\n\nEn esta página puedes ver las tareas de «{name}», marcarlas como hechas, cambiar su fecha, comentar y descargar sus archivos adjuntos, sin necesidad de cuenta:\n\n{url}\n\nEl enlace deja de funcionar si nadie lo usa hasta el {date}.", { name: column.name, url, date: until ?? "" }),
    )
    : null;

  // El enlace que tiene quien está fuera deja de funcionar: como «Revocar», se confirma.
  const fresh = async () => {
    const ok = await confirm({
      title: t("Crear un enlace nuevo"),
      message: t("El enlace actual dejará de funcionar al momento para quien lo tenga y habrá que enviarle el nuevo. ¿Crear uno nuevo?"),
      confirmLabel: t("Crear un enlace nuevo"),
      danger: true,
    });
    if (ok) onFresh();
  };

  const revoke = async () => {
    const ok = await confirm({ title: t("Revocar enlace"), message: t("La web dejará de funcionar al momento para quien tenga el enlace. Podrás generar otro después. ¿Revocarlo?"), confirmLabel: t("Revocar enlace"), danger: true });
    if (!ok) return;
    const res = await track(revokeShareLink(column.id));
    if (!res.ok) return toast(res.error, "error");
    toast(t("Enlace revocado"));
    onRevoked(res.data);
  };

  return (
    <Modal open onClose={onClose} size="sm" title={t("Web de «{name}»", { name: column.name })} footer={<button type="button" className="btn-secondary" onClick={onClose}>{t("Cerrar")}</button>}>
      <div className="space-y-4 text-sm">
        {state.published !== undefined && (
          <p className="font-medium text-emerald-700 dark:text-emerald-400" data-share-published>
            {state.published === 1 ? t("Se ha publicado 1 tarea.") : t("Se han publicado {n} tareas.", { n: state.published })}
            {state.left ? <span className="font-normal text-slate-600 dark:text-slate-400"> {t("{n} no caben y no salen en la web.", { n: state.left })}</span> : null}
          </p>
        )}
        {url ? (
          <section className="space-y-2">
            <h3 className="text-xs font-semibold tracking-wide text-slate-500 uppercase dark:text-slate-400">{t("Dirección de la web")}</h3>
            <button
              type="button"
              data-pz-no-capture=""
              data-share-url
              onClick={() => void copy()}
              title={t("Pulsa para copiar")}
              className="block w-full rounded-lg border border-slate-300 bg-slate-50 px-3 py-2.5 text-left font-mono text-xs break-all text-slate-900 hover:bg-slate-100 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700"
            >
              {url}
            </button>
            <div className="flex flex-wrap gap-2">
              <button type="button" className="btn-primary" onClick={() => void copy()}><Copy size={14} aria-hidden /> {t("Copiar")}</button>
              <a className="btn-secondary" href={url} target="_blank" rel="noopener noreferrer" data-pz-no-capture="" data-share-open><ExternalLink size={14} aria-hidden /> {t("Abrir")}</a>
              {mailto && <a className="btn-secondary" href={mailto} data-pz-no-capture=""><Mail size={14} aria-hidden /> {t("Enviar por email")}</a>}
            </div>
            <p className="text-xs text-slate-600 dark:text-slate-400">{t("Cualquiera con esta dirección puede ver estas tareas, marcarlas como hechas, cambiar su fecha, comentar y descargar sus adjuntos, sin cuenta.")}</p>
          </section>
        ) : state.lost && info?.state === "active" ? (
          <section className="space-y-2">
            <p className="text-slate-600 dark:text-slate-400" data-share-lost>{t("El enlace sigue funcionando, pero Pizarro no puede volver a enseñar su dirección: se creó con una versión anterior o ha cambiado la clave de cifrado de la instalación. Quien ya la tiene puede seguir usándola. Si necesitas la dirección, crea un enlace nuevo (el actual dejará de funcionar).")}</p>
            <button type="button" className="btn-secondary" onClick={() => void fresh()} data-share-fresh>{t("Crear un enlace nuevo")}</button>
          </section>
        ) : null}
        {revokedLine && <p className="text-slate-600 dark:text-slate-400" data-share-revoked>{revokedLine}</p>}
        {until && <p className="text-xs text-slate-500 dark:text-slate-400">{t("Vale hasta el {date} si nadie la usa (abrirla o actualizarla cuenta como uso).", { date: until })}</p>}
        {info?.state === "active" && (
          <div className="border-t border-slate-200 pt-3 dark:border-slate-700">
            <button type="button" className="btn-secondary border-red-300 text-red-700 hover:bg-red-50 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950/40" onClick={() => void revoke()} data-share-revoke>{t("Revocar enlace")}</button>
          </div>
        )}
      </div>
    </Modal>
  );
}
