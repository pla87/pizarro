"use client";

import { AtSign, Bell, CalendarClock, Check, CheckCheck, FolderInput, Mail, MailX, MessageCircle, MessageSquare, Reply, Send, UserPlus, Hourglass } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { markAllNotificationsRead, markNotificationRead } from "@/actions/notifications";
import { Avatar } from "@/components/ui/Avatar";
import { cn } from "@/components/ui/cn";
import { useIntlLocale, useT } from "@/i18n/client";
import { formatDate } from "@/lib/format";
import { assignedBatchCount, notificationBody, notificationHeadline, projectNoticePath, quotesWriting, type NotificationKind } from "@/lib/notification-text";
import { announceUnreadCount, latestOnly, restoreUnread } from "@/lib/unread-core";
import { useToast } from "@/components/ui/Toast";
import { useSafeRefresh } from "@/components/useSafeRefresh";
import { useActionTransition } from "@/components/useActionTransition";

interface Item {
  id: string;
  type: NotificationKind;
  excerpt: string;
  createdAt: string;
  read: boolean;
  viaEmail: boolean;
  viaWhatsapp: boolean;
  viaTelegram?: boolean;
  actor: { id: string; name: string } | null;
  task: { id: string; title: string; projectId: string; projectName: string } | null;
  /** Aviso de un proyecto (PROJECT_TO_TEAM, REPORT_UNSUBSCRIBED): lleva al proyecto o a sus ajustes (projectNoticePath). */
  project?: { id: string; name: string } | null;
}

const ICONS: Record<NotificationKind, typeof AtSign> = {
  MENTION: AtSign,
  ASSIGNED: UserPlus,
  DUE_CHANGED: CalendarClock,
  COMMENT: MessageSquare,
  REPLY: Reply,
  WAITING: Hourglass,
  PROJECT_TO_TEAM: FolderInput,
  REPORT_UNSUBSCRIBED: MailX,
};

/**
 * Avisos leídos desde esta lista en esta pestaña. Como leer uno ya no refresca la página, al volver atrás desde el
 * tablero Next puede pintar la lista que tenía guardada, de antes de leerlo: con esto sale como leído.
 */
const readHere = new Set<string>();

/**
 * `unreadTotal`: sin leer de verdad (contados en el servidor con tope `unreadCap`), no solo los cargados. A partir del
 * tope se dice «Más de 99 sin leer», como la insignia de la cabecera («99+»).
 */
export function NotificationList({ items: initial, moreHref, unreadTotal, unreadCap }: { items: Item[]; moreHref: string | null; unreadTotal: number; unreadCap: number }) {
  const router = useRouter();
  const safeRefresh = useSafeRefresh();
  const t = useT();
  const locale = useIntlLocale();
  const toast = useToast();
  const fromServer = (list: Item[]) => list.map((i) => (!i.read && readHere.has(i.id) ? { ...i, read: true } : i));
  const [items, setItems] = useState(() => fromServer(initial));
  const [pending, start] = useActionTransition();
  const [allRead, setAllRead] = useState(false);
  // El recuento que devolvió el servidor al leer aquí (el real, con tope): manda sobre la cuenta hecha con lo cargado.
  const [counted, setCounted] = useState<number | null>(null);
  const [gate] = useState(latestOnly);
  // Si el servidor vuelve a pintar la página (refresco o «Cargar más»), su lista y su número son más recientes que los
  // de aquí. Sin volver a montar la lista (antes con key={limit}): el foco del teclado no se pierde al cargar más.
  const [countedFor, setCountedFor] = useState(initial);
  if (countedFor !== initial) {
    setCountedFor(initial);
    setCounted(null);
    setAllRead(false);
    setItems(fromServer(initial));
  }
  // Tras «Cargar más», el foco va al primer aviso nuevo (si no hubiera, se queda en el botón). Se olvida con la primera
  // lista que llegue del servidor aunque no haya crecido (avisos borrados entretanto): si no, el foco saltaba al aviso
  // `from` la próxima vez que creciera.
  const focusFrom = useRef<number | null>(null);
  const listRef = useRef<HTMLUListElement>(null);
  useEffect(() => {
    const from = focusFrom.current;
    if (from === null) return;
    focusFrom.current = null;
    listRef.current?.querySelectorAll<HTMLElement>("[data-notice-open]")[from]?.focus();
  }, [initial]);
  // Hasta entonces: los sin leer que no están cargados (según las props del servidor) más los cargados que siguen sin leer aquí.
  const outside = Math.max(0, unreadTotal - initial.filter((i) => !i.read).length);
  const unread = counted ?? (allRead ? 0 : outside + items.filter((i) => !i.read).length);
  const many = counted !== null ? counted >= unreadCap : !allRead && unreadTotal >= unreadCap;

  /** Pone en la lista y en la cabecera (`pz:unread`, AppShell) el número del servidor, si es la respuesta más reciente. */
  const applyCount = (seq: number, count: number) => {
    if (!gate.isLatest(seq)) return;
    setCounted(count);
    announceUnreadCount(count);
  };

  // Sin router.refresh(): el contador de la cabecera y la insignia de la app los pone `pz:unread` (AppShell) con el
  // recuento que devuelve la acción. Al abrir un aviso, el refresco llegaba ya en la página de destino y pedía otra vez el
  // tablero entero.
  const markRead = (item: Item) => {
    readHere.add(item.id);
    setItems((list) => list.map((x) => (x.id === item.id ? { ...x, read: true } : x)));
    const seq = gate.next();
    // Si no se ha guardado (o no ha llegado al servidor), el aviso vuelve a estar sin leer.
    const revert = () => {
      readHere.delete(item.id);
      setItems((list) => list.map((x) => (x.id === item.id ? { ...x, read: false } : x)));
    };
    start(async () => {
      let res: Awaited<ReturnType<typeof markNotificationRead>>;
      try {
        res = await markNotificationRead(item.id);
      } catch (err) {
        revert();
        throw err;
      }
      if (!res.ok) {
        revert();
        // Y el contador, a lo que diga el servidor.
        safeRefresh();
        return;
      }
      applyCount(seq, res.data.unreadCount);
    });
  };

  const markAll = () =>
    start(async () => {
      const wasUnread = new Set(items.filter((x) => !x.read).map((x) => x.id));
      setItems((list) => list.map((x) => ({ ...x, read: true })));
      setAllRead(true);
      const seq = gate.next();
      const undo = () => {
        setItems((list) => restoreUnread(list, wasUnread, readHere));
        setAllRead(false);
      };
      let res: Awaited<ReturnType<typeof markAllNotificationsRead>>;
      try {
        res = await markAllNotificationsRead();
      } catch (err) {
        undo();
        throw err;
      }
      if (!res.ok) {
        undo();
        toast(res.error, "error");
        return;
      }
      applyCount(seq, res.data.unreadCount);
      // Aquí sí se refresca (es esta misma página, no el tablero): los que no están cargados también pasan a
      // leídos, y al volver atrás no sale la lista de antes.
      safeRefresh();
    });

  const open = (item: Item) => {
    if (!item.read) markRead(item);
    if (item.task) router.push(`/p/${item.task.projectId}?task=${item.task.id}`);
    else if (item.project) router.push(projectNoticePath(item.type, item.project.id));
  };

  return (
    <div className="mx-auto max-w-3xl p-4 md:p-6">
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <div>
          <h1 className="text-xl font-semibold">{t("Avisos")}</h1>
          <p className="text-sm text-slate-500">{many ? t("Más de 99 sin leer") : unread ? t("{n} sin leer", { n: unread }) : t("Estás al día.")}</p>
        </div>
        {unread > 0 && (
          <button
            className="btn-secondary ml-auto"
            disabled={pending}
            onClick={markAll}
          >
            <CheckCheck size={16} /> {t("Marcar todo como leído")}
          </button>
        )}
      </div>
      {items.length === 0 ? (
        <div className="card flex flex-col items-center gap-2 p-10 text-sm text-slate-500">
          <Bell size={32} className="text-slate-300" /> {t("Aquí aparecerán las menciones, asignaciones, cambios de fecha y comentarios que te afecten.")}
        </div>
      ) : (
        <ul ref={listRef} className="card divide-y divide-slate-200 dark:divide-slate-800">
          {items.map((n) => {
            const Icon = ICONS[n.type] ?? AtSign;
            // Asignación en lote: el número ya va en la cabecera («te ha asignado 5 tareas (entre ellas «…»)»).
            const batch = n.type === "ASSIGNED" && (assignedBatchCount(n.excerpt) ?? 0) > 1;
            const body = batch ? "" : notificationBody(n.type, n.excerpt, t, locale);
            return (
              <li key={n.id} className={cn("flex items-stretch hover:bg-slate-50 dark:hover:bg-slate-800/50", !n.read && "bg-brand-50/50 dark:bg-brand-500/5")}>
                <button data-notice-open onClick={() => open(n)} className="flex min-w-0 flex-1 gap-3 px-4 py-3 text-left">
                  <span className="relative shrink-0">
                    {n.actor ? (
                      <Avatar id={n.actor.id} name={n.actor.name} size="md" />
                    ) : n.project ? (
                      // Aviso de proyecto (sin autor): el icono del proyecto en lugar del avatar.
                      <span className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-50 text-brand-600 dark:bg-brand-500/15 dark:text-brand-200" aria-hidden><Icon size={16} /></span>
                    ) : (
                      <span className="block h-8 w-8" />
                    )}
                    {!n.project && (
                      <span className="absolute -right-1 -bottom-1 flex h-4 w-4 items-center justify-center rounded-full bg-white text-brand-600 ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-700" aria-hidden>
                        <Icon size={10} />
                      </span>
                    )}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm">
                      {n.project
                        // Aviso de proyecto: la cuenta borrada (o quien se dio de baja del informe) va en el extracto y el
                        // proyecto en lugar de la tarea.
                        ? notificationHeadline(n.type, t, { actor: n.excerpt || t("Usuario eliminado"), task: t("«{title}»", { title: n.project.name }) })
                        : notificationHeadline(n.type, t, { actor: n.actor?.name ?? t("Alguien"), task: n.task ? t("«{title}»", { title: n.task.title }) : t("una tarea borrada"), excerpt: n.excerpt })}
                      {n.task && <span className="text-slate-500"> · {n.task.projectName}</span>}
                    </p>
                    {/* Lo escrito por una persona (comentario, respuesta, mención), como cita: no se confunde con el texto del aviso. */}
                    {body && <p dir="auto" className={cn("mt-0.5 line-clamp-2 text-sm text-slate-600 dark:text-slate-400", quotesWriting(n.type) && "border-s-2 border-slate-300 ps-2 dark:border-slate-600")}>{body}</p>}
                    <p className="mt-1 flex items-center gap-2 text-xs text-slate-500">
                      {formatDate(n.createdAt, "dateTimeShort", locale)}
                      {n.viaEmail && <span className="inline-flex items-center gap-0.5" title={t("Enviado por email")}><Mail size={12} /></span>}
                      {n.viaWhatsapp && <span className="inline-flex items-center gap-0.5" title={t("Enviado por WhatsApp")}><MessageCircle size={12} /></span>}
                      {n.viaTelegram && <span className="inline-flex items-center gap-0.5" title={t("Enviado por Telegram")}><Send size={12} /></span>}
                    </p>
                  </div>
                  {!n.read && <span className="mt-2 h-2 w-2 shrink-0 rounded-full bg-brand-600" aria-label={t("Sin leer")} />}
                </button>
                {!n.read && (
                  <button className="btn-icon my-auto mr-2 shrink-0" onClick={() => markRead(n)} aria-label={t("Marcar como leído")} title={t("Marcar como leído")}>
                    <Check size={16} />
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {moreHref && (
        <div className="mt-4 text-center">
          <Link href={moreHref} scroll={false} onClick={() => (focusFrom.current = items.length)} className="btn-secondary">{t("Cargar más")}</Link>
        </div>
      )}
    </div>
  );
}
