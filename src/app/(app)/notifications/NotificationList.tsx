"use client";

import { Bell, CheckCheck, Mail, MessageCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { markAllNotificationsRead, markNotificationRead } from "@/actions/notifications";
import { Avatar } from "@/components/ui/Avatar";
import { cn } from "@/components/ui/cn";

interface Item {
  id: string;
  excerpt: string;
  createdAt: string;
  read: boolean;
  viaEmail: boolean;
  viaWhatsapp: boolean;
  actor: { id: string; name: string } | null;
  task: { id: string; title: string; projectId: string; projectName: string } | null;
}

export function NotificationList({ items: initial }: { items: Item[] }) {
  const router = useRouter();
  const [items, setItems] = useState(initial);
  const [pending, start] = useTransition();
  const unread = items.filter((i) => !i.read).length;

  const open = (item: Item) => {
    if (!item.read) {
      setItems((list) => list.map((x) => (x.id === item.id ? { ...x, read: true } : x)));
      markNotificationRead(item.id);
    }
    if (item.task) router.push(`/p/${item.task.projectId}?task=${item.task.id}`);
  };

  return (
    <div className="mx-auto max-w-3xl p-4 md:p-6">
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <div>
          <h1 className="text-xl font-semibold">Avisos</h1>
          <p className="text-sm text-slate-500">{unread ? `${unread} sin leer` : "Estás al día."}</p>
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
            <CheckCheck size={16} /> Marcar todo como leído
          </button>
        )}
      </div>
      {items.length === 0 ? (
        <div className="card flex flex-col items-center gap-2 p-10 text-sm text-slate-500">
          <Bell size={32} className="text-slate-300" /> Cuando alguien te mencione con @ aparecerá aquí.
        </div>
      ) : (
        <ul className="card divide-y divide-slate-200 dark:divide-slate-800">
          {items.map((n) => (
            <li key={n.id}>
              <button onClick={() => open(n)} className={cn("flex w-full gap-3 px-4 py-3 text-left hover:bg-slate-50 dark:hover:bg-slate-800/50", !n.read && "bg-brand-50/50 dark:bg-brand-500/5")}>
                {n.actor ? <Avatar id={n.actor.id} name={n.actor.name} size="md" /> : <span className="h-8 w-8" />}
                <div className="min-w-0 flex-1">
                  <p className="text-sm">
                    <strong>{n.actor?.name ?? "Alguien"}</strong> te ha mencionado en{" "}
                    <strong>{n.task ? `«${n.task.title}»` : "una tarea borrada"}</strong>
                    {n.task && <span className="text-slate-500"> · {n.task.projectName}</span>}
                  </p>
                  {n.excerpt && <p className="mt-0.5 line-clamp-2 text-sm text-slate-600 dark:text-slate-400">{n.excerpt}</p>}
                  <p className="mt-1 flex items-center gap-2 text-xs text-slate-400">
                    {new Date(n.createdAt).toLocaleString("es-ES", { dateStyle: "short", timeStyle: "short" })}
                    {n.viaEmail && <span className="inline-flex items-center gap-0.5" title="Enviado por email"><Mail size={12} /></span>}
                    {n.viaWhatsapp && <span className="inline-flex items-center gap-0.5" title="Enviado por WhatsApp"><MessageCircle size={12} /></span>}
                  </p>
                </div>
                {!n.read && <span className="mt-2 h-2 w-2 shrink-0 rounded-full bg-brand-600" aria-label="Sin leer" />}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
