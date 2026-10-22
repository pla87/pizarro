"use client";

import { AtSign, Bell, CalendarClock, Check, CheckCheck, Mail, MessageCircle, MessageSquare, Reply, UserPlus } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { markAllNotificationsRead, markNotificationRead } from "@/actions/notifications";
import { Avatar } from "@/components/ui/Avatar";
import { cn } from "@/components/ui/cn";
import { useIntlLocale, useT } from "@/i18n/client";
import { formatDate } from "@/lib/format";
import { dueChangeText, notificationHeadline, type NotificationKind } from "@/lib/notification-text";

interface Item {
  id: string;
  type: NotificationKind;
  excerpt: string;
  createdAt: string;
  read: boolean;
  viaEmail: boolean;
  viaWhatsapp: boolean;
  actor: { id: string; name: string } | null;
  task: { id: string; title: string; projectId: string; projectName: string } | null;
}

const ICONS: Record<NotificationKind, typeof AtSign> = {
  MENTION: AtSign,
  ASSIGNED: UserPlus,
  DUE_CHANGED: CalendarClock,
  COMMENT: MessageSquare,
  REPLY: Reply,
};

export function NotificationList({ items: initial, moreHref }: { items: Item[]; moreHref: string | null }) {
  const router = useRouter();
  const t = useT();
  const locale = useIntlLocale();
  const [items, setItems] = useState(initial);
  const [pending, start] = useTransition();
  const unread = items.filter((i) => !i.read).length;

  // router.refresh() actualiza el contador de la barra lateral y la insignia de la app.
  const markRead = (item: Item) => {
    setItems((list) => list.map((x) => (x.id === item.id ? { ...x, read: true } : x)));
    start(async () => {
      await markNotificationRead(item.id);
      router.refresh();
    });
  };

  const open = (item: Item) => {
    if (!item.read) markRead(item);
    if (item.task) router.push(`/p/${item.task.projectId}?task=${item.task.id}`);
  };

  return (
    <div className="mx-auto max-w-3xl p-4 md:p-6">
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <div>
          <h1 className="text-xl font-semibold">{t("Avisos")}</h1>
          <p className="text-sm text-slate-500">{unread ? t("{n} sin leer", { n: unread }) : t("Estás al día.")}</p>
        </div>
        {unread > 0 && (
          <button
            className="btn-secondary ml-auto"
            disabled={pending}
            onClick={() =>
              start(async () => {
                setItems((list) => list.map((x) => ({ ...x, read: true })));
                await markAllNotificationsRead();
                router.refresh();
              })
            }
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
        <ul className="card divide-y divide-slate-200 dark:divide-slate-800">
          {items.map((n) => {
            const Icon = ICONS[n.type] ?? AtSign;
            const body = n.type === "DUE_CHANGED" ? dueChangeText(n.excerpt, t, locale) : n.excerpt;
            return (
              <li key={n.id} className={cn("flex items-stretch hover:bg-slate-50 dark:hover:bg-slate-800/50", !n.read && "bg-brand-50/50 dark:bg-brand-500/5")}>
                <button onClick={() => open(n)} className="flex min-w-0 flex-1 gap-3 px-4 py-3 text-left">
                  <span className="relative shrink-0">
                    {n.actor ? <Avatar id={n.actor.id} name={n.actor.name} size="md" /> : <span className="block h-8 w-8" />}
                    <span className="absolute -right-1 -bottom-1 flex h-4 w-4 items-center justify-center rounded-full bg-white text-brand-600 ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-700" aria-hidden>
                      <Icon size={10} />
                    </span>
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm">
                      {notificationHeadline(n.type, t, { actor: n.actor?.name ?? t("Alguien"), task: n.task ? t("«{title}»", { title: n.task.title }) : t("una tarea borrada") })}
                      {n.task && <span className="text-slate-500"> · {n.task.projectName}</span>}
                    </p>
                    {body && <p className="mt-0.5 line-clamp-2 text-sm text-slate-600 dark:text-slate-400">{body}</p>}
                    <p className="mt-1 flex items-center gap-2 text-xs text-slate-400">
                      {formatDate(n.createdAt, "dateTimeShort", locale)}
                      {n.viaEmail && <span className="inline-flex items-center gap-0.5" title={t("Enviado por email")}><Mail size={12} /></span>}
                      {n.viaWhatsapp && <span className="inline-flex items-center gap-0.5" title={t("Enviado por WhatsApp")}><MessageCircle size={12} /></span>}
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
          <Link href={moreHref} scroll={false} className="btn-secondary">{t("Cargar más")}</Link>
        </div>
      )}
    </div>
  );
}
