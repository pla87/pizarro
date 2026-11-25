"use client";

import { useState } from "react";
import { Copy, Globe, Link2, Mail } from "lucide-react";
import { setColumnShareOut } from "@/actions/columns";
import { generateShareWeb, revokeShareLink, setShareExpiry } from "@/actions/share-out";
import { DEFAULT_SHARE_EXPIRY_DAYS, nextShareExpiry, shareExpiryLabel, shareMailto, shareStateText, type BoardShareInfo } from "@/lib/share-out-board";
import type { BoardColumn } from "@/lib/types";
import { useIntlLocale, useT } from "@/i18n/client";
import { cn } from "../ui/cn";
import { copyText } from "../ui/clipboard";
import { useConfirm } from "../ui/ConfirmDialog";
import { Modal } from "../ui/Modal";
import { useToast } from "../ui/Toast";
import { useBoard } from "./context";

// Columna «Compartir fuera» (lib/share-out*.ts): sus tareas se publican en una página sin cuenta (/x/<token>) para alguien
// de fuera. Aquí, la marca de la cabecera, el pie con «Generar web» / «Actualizar web», el aviso de los adjuntos y el
// selector de caducidad, y el diálogo con la dirección. Pizarro no guarda la dirección (solo su huella): la ve quien la
// genera, en el diálogo; este navegador la recuerda mientras el enlace siga siendo el mismo (localStorage, por comodidad).

/** La dirección que recuerda este navegador para el enlace `linkId` de la columna, si es la del enlace actual. */
function rememberedUrl(columnId: string, linkId: string | null): string | null {
  if (!linkId) return null;
  try {
    const saved = JSON.parse(localStorage.getItem(`pz-share-url:${columnId}`) ?? "null") as { linkId?: string; url?: string } | null;
    return saved?.linkId === linkId && typeof saved.url === "string" ? saved.url : null;
  } catch {
    return null;
  }
}
function rememberUrl(columnId: string, linkId: string | null, url: string): void {
  try {
    if (linkId) localStorage.setItem(`pz-share-url:${columnId}`, JSON.stringify({ linkId, url }));
  } catch {
    // Sin almacenamiento (ventana privada): el diálogo ya la enseña.
  }
}

function useDay() {
  const locale = useIntlLocale();
  return (iso: string) => new Date(iso).toLocaleDateString(locale, { day: "numeric", month: "short", year: "numeric" });
}

/** Marca discreta de la cabecera: hay enlace activo (y hasta cuándo), caducó o aún no se ha generado. */
export function ShareBadge({ info }: { info: BoardShareInfo | null | undefined }) {
  const t = useT();
  const day = useDay();
  if (!info) return null;
  const s = shareStateText(info);
  const text = s.date ? t(s.key, { date: day(s.date) }) : t(s.key);
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

/** Pie de la columna: «Generar web» / «Actualizar web», el aviso de los adjuntos y la caducidad. */
export function ShareFooter({ column }: { column: BoardColumn }) {
  const t = useT();
  const toast = useToast();
  const { track, setColumns } = useBoard();
  const info = column.share ?? null;
  const [busy, setBusy] = useState(false);
  const [dialog, setDialog] = useState<{ url: string | null; fresh: boolean; published?: number; left?: number } | null>(null);
  const days = info?.expiryDays ?? DEFAULT_SHARE_EXPIRY_DAYS;
  const active = info?.state === "active";
  const apply = (next: BoardShareInfo) => setColumns((cols) => cols.map((c) => (c.id === column.id ? { ...c, share: next } : c)));

  const generate = async (fresh = false) => {
    if (busy) return;
    setBusy(true);
    const res = await track(generateShareWeb(column.id, { fresh })).catch(() => ({ ok: false as const, error: t("Sin conexión: no se ha guardado") }));
    setBusy(false);
    if (!res.ok) return toast(res.error, "error");
    apply(res.data.info);
    if (res.data.url) rememberUrl(column.id, res.data.info.linkId, res.data.url);
    setDialog({ url: res.data.url ?? rememberedUrl(column.id, res.data.info.linkId), fresh: !!res.data.url, published: res.data.published, left: res.data.left });
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
  return (
    <div className="space-y-1.5 border-t border-slate-200 px-2 pt-2 pb-2 dark:border-slate-700/70" data-share-footer>
      <div className="flex items-center gap-1.5">
        <button type="button" className="btn-primary flex-1 py-1.5 aria-busy:cursor-progress" aria-busy={busy || undefined} onClick={() => void generate()} data-share-generate>
          <Globe size={15} aria-hidden /> {active ? t("Actualizar web") : t("Generar web")}
        </button>
        {active && (
          <button type="button" className="btn-icon h-8 w-8" onClick={() => setDialog({ url: rememberedUrl(column.id, info?.linkId ?? null), fresh: false })} aria-label={t("Enlace de la web")} title={t("Enlace de la web")}>
            <Link2 size={15} />
          </button>
        )}
      </div>
      <div className="flex items-start gap-2">
        <p className="min-w-0 flex-1 text-[11px] leading-snug text-slate-600 dark:text-slate-400">{t("Todos los archivos adjuntos de estas tareas se podrán descargar desde la web.")}</p>
        {/* Caducidad: rota 7 días / 1 mes / 3 meses sin uso, con el aspecto del interruptor de cadencia de las tareas fijas. */}
        <button
          type="button"
          data-share-expiry={days}
          onClick={() => void cycle()}
          aria-label={t("Caduca tras {label} sin uso: pulsa para cambiarlo", { label: t(label) })}
          title={t("Caduca tras {label} sin uso: pulsa para cambiarlo", { label: t(label) })}
          className={cn(
            "inline-flex h-4 shrink-0 items-center gap-1 rounded-full border border-progress px-1.5 text-[10px] leading-none text-slate-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-progress dark:text-slate-300",
            days !== DEFAULT_SHARE_EXPIRY_DAYS ? "bg-progress/20 font-semibold" : "bg-transparent opacity-80 hover:opacity-100",
          )}
        >
          <span className="h-1.5 w-1.5 rounded-full bg-progress" aria-hidden />
          {t(label)}
        </button>
      </div>
      {dialog && <ShareDialog column={column} state={dialog} onClose={() => setDialog(null)} onFresh={() => void generate(true)} onRevoked={(next) => { apply(next); setDialog(null); }} />}
    </div>
  );
}

/**
 * Diálogo tras «Generar web» / «Actualizar web» (o desde el botón del enlace): la dirección con clic para copiar, «Copiar»,
 * «Enviar por email» (mailto: con asunto y cuerpo; lo envía el correo de quien comparte) y hasta cuándo vale. Sin la
 * dirección (Pizarro no la guarda), lo explica y ofrece un enlace nuevo. «Revocar enlace», con confirmación.
 */
function ShareDialog({ column, state, onClose, onFresh, onRevoked }: {
  column: BoardColumn;
  state: { url: string | null; fresh: boolean; published?: number; left?: number };
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
  const url = state.url;

  const copy = async () => {
    if (!url) return;
    toast((await copyText(url)) ? t("Enlace copiado") : t("No se ha podido copiar"), undefined);
  };
  const mailto = url
    ? shareMailto(
      t("Tareas de «{name}»", { name: column.name }),
      t("Hola:\n\nEn esta página puedes ver las tareas de «{name}», marcarlas como hechas, cambiar su fecha, comentar y descargar sus archivos adjuntos, sin necesidad de cuenta:\n\n{url}\n\nEl enlace deja de funcionar si nadie lo usa hasta el {date}.", { name: column.name, url, date: until ?? "" }),
    )
    : null;

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
      <div className="space-y-3 text-sm">
        {state.published !== undefined && (
          <p>{state.published === 1 ? t("Se ha publicado 1 tarea.") : t("Se han publicado {n} tareas.", { n: state.published })}{state.left ? ` ${t("{n} no caben y no salen en la web.", { n: state.left })}` : ""}</p>
        )}
        {url ? (
          <>
            <p className="text-slate-600 dark:text-slate-400">{t("Cualquiera con esta dirección puede ver estas tareas, marcarlas como hechas, cambiar su fecha, comentar y descargar sus adjuntos, sin cuenta.")}</p>
            <button
              type="button"
              data-pz-no-capture=""
              data-share-url
              onClick={() => void copy()}
              title={t("Pulsa para copiar")}
              className="block w-full rounded-md border border-slate-300 bg-slate-50 px-2 py-1.5 text-left font-mono text-xs break-all hover:bg-slate-100 dark:border-slate-600 dark:bg-slate-800 dark:hover:bg-slate-700"
            >
              {url}
            </button>
            <div className="flex flex-wrap gap-2">
              <button type="button" className="btn-primary" onClick={() => void copy()}><Copy size={14} aria-hidden /> {t("Copiar")}</button>
              {mailto && <a className="btn-secondary" href={mailto} data-pz-no-capture=""><Mail size={14} aria-hidden /> {t("Enviar por email")}</a>}
            </div>
          </>
        ) : (
          <>
            <p className="text-slate-600 dark:text-slate-400">{t("La dirección es la misma de antes. Pizarro no la guarda: la tiene quien la generó y a quien se la envió. Si no la tienes, crea un enlace nuevo (el anterior dejará de funcionar).")}</p>
            <button type="button" className="btn-secondary" onClick={onFresh}>{t("Crear un enlace nuevo")}</button>
          </>
        )}
        {until && <p>{t("Vale hasta el {date} si nadie la usa (abrirla o actualizarla cuenta como uso).", { date: until })}</p>}
        {info?.state === "active" && (
          <button type="button" className="text-sm font-medium text-red-700 hover:underline dark:text-red-400" onClick={() => void revoke()}>{t("Revocar enlace")}</button>
        )}
      </div>
    </Modal>
  );
}
