"use client";

import { BellRing, Loader2, MonitorSmartphone } from "lucide-react";
import { useEffect, useState } from "react";
import { pushSetup, removePushDevice, savePushPrefs, subscribePush, testPush, unsubscribePush } from "@/actions/push";
import { useToast } from "@/components/ui/Toast";
import { useActionTransition } from "@/components/useActionTransition";
import { useIntlLocale, useT } from "@/i18n/client";
import { formatDate } from "@/lib/format";
import type { ChannelPrefs } from "@/lib/messaging-core";
import { currentPushSubscription, keyBytes, notificationSettingsHint, pushSupport, pushWorkerReady, rememberPushHash, sameServerKey, sha256Hex, type PushSupport } from "@/lib/push-client";
import { resyncPush } from "@/lib/push-sync";
import type { PushView } from "@/lib/web-push";

const PREF_LABELS: { key: keyof ChannelPrefs; label: string }[] = [
  { key: "notifyMention", label: "Menciones (@) en tareas y notas" },
  { key: "notifyAssigned", label: "Tareas que me asignan" },
  { key: "notifyComment", label: "Comentarios y respuestas en tareas que sigo" },
  { key: "notifyDue", label: "Cambios de fecha límite y recordatorios" },
];

interface DeviceState {
  support: PushSupport;
  permission: NotificationPermission | null;
  /** Huella del endpoint de la suscripción de este navegador (con la clave de la instalación), o null. */
  hash: string | null;
}

/** Lo que se sabe de este navegador: si admite push, el permiso y su suscripción. */
async function probeDevice(publicKey: string): Promise<DeviceState> {
  const support = pushSupport();
  if (support !== "ok") return { support, permission: null, hash: null };
  const sub = await currentPushSubscription().catch(() => null);
  return { support, permission: Notification.permission, hash: sub && sameServerKey(sub, publicKey) ? await sha256Hex(sub.endpoint) : null };
}

/**
 * Mi perfil → Avisos → «Avisos en este dispositivo»: avisos push del navegador (gratis, sin configurar nada en
 * Administración). El interruptor pide permiso al navegador y suscribe o desuscribe este dispositivo; la lista enseña
 * todos los de la persona, con «Quitar».
 */
export function PushSection({ initial }: { initial: PushView }) {
  const t = useT();
  const locale = useIntlLocale();
  const toast = useToast();
  const [view, setView] = useState(initial);
  const [pending, run] = useActionTransition();
  // Lo que se sabe del navegador llega tras montar (en el servidor no hay navigator).
  const [device, setDevice] = useState<DeviceState | null>(null);
  const support = device?.support ?? null;
  const permission = device?.permission ?? null;
  const hereHash = device?.hash ?? null;
  const setPermission = (p: NotificationPermission) => setDevice((d) => (d ? { ...d, permission: p } : d));
  const [form, setForm] = useState(initial.prefs);
  const dirty = PREF_LABELS.some(({ key }) => form[key] !== view.prefs[key]);

  useEffect(() => {
    let alive = true;
    (async () => {
      // Si el navegador cambió la suscripción por su cuenta, se renueva en silencio antes de mirar el estado.
      const renewed = await resyncPush();
      const d = await probeDevice(initial.publicKey);
      if (!alive) return;
      setDevice(d);
      if (renewed) {
        const res = await pushSetup();
        if (alive && res.ok) setView(res.data);
      } else if (d.hash && initial.devices.some((x) => x.hash === d.hash)) {
        rememberPushHash(d.hash);
      }
    })().catch(() => {});
    return () => {
      alive = false;
    };
  }, [initial.publicKey, initial.devices]);

  const refresh = async () => {
    const res = await pushSetup();
    if (res.ok) {
      setView(res.data);
      setDevice(await probeDevice(res.data.publicKey));
    }
  };

  const here = Boolean(hereHash && view.devices.some((d) => d.hash === hereHash));

  const turnOn = () =>
    run(async () => {
      let perm: NotificationPermission;
      try {
        perm = await Notification.requestPermission();
      } catch {
        perm = Notification.permission;
      }
      setPermission(perm);
      if (perm === "denied") return toast(t("El navegador tiene bloqueadas las notificaciones de Pizarro. Permítelas en la configuración del sitio (el candado junto a la dirección) y vuelve a marcar la casilla."), "error");
      if (perm !== "granted") return toast(t("No se han activado los avisos porque el navegador no ha recibido tu permiso. Vuelve a marcar la casilla y pulsa «Permitir»."), "error");
      let reg: ServiceWorkerRegistration;
      try {
        reg = await pushWorkerReady();
      } catch {
        return toast(t("No se ha podido registrar el servicio de avisos del navegador. Recarga la página e inténtalo de nuevo."), "error");
      }
      let sub: PushSubscription;
      let fresh = false;
      try {
        const prev = await reg.pushManager.getSubscription();
        if (prev && !sameServerKey(prev, view.publicKey)) await prev.unsubscribe();
        const keep = prev && sameServerKey(prev, view.publicKey) ? prev : null;
        fresh = !keep;
        sub = keep ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(view.publicKey) }));
      } catch {
        return toast(t("El navegador no ha podido activar los avisos. Si usas Brave, activa «Usar los servicios de Google para la mensajería push» en su configuración."), "error");
      }
      const json = sub.toJSON();
      const res = await subscribePush({ endpoint: json.endpoint ?? "", keys: { p256dh: json.keys?.p256dh ?? "", auth: json.keys?.auth ?? "" } });
      if (!res.ok) {
        if (fresh) await sub.unsubscribe().catch(() => {});
        toast(res.error, "error");
        return;
      }
      rememberPushHash(await sha256Hex(sub.endpoint));
      await refresh();
      toast(t("Avisos activados en este dispositivo."), "success");
    });

  const turnOff = () =>
    run(async () => {
      const sub = await currentPushSubscription().catch(() => null);
      if (sub) {
        const res = await unsubscribePush({ endpoint: sub.endpoint });
        if (!res.ok) return toast(res.error, "error");
        await sub.unsubscribe().catch(() => {});
      }
      rememberPushHash(null);
      await refresh();
      toast(t("Avisos desactivados en este dispositivo."), "success");
    });

  const remove = (id: string, hash: string) =>
    run(async () => {
      const res = await removePushDevice(id);
      if (!res.ok) toast(res.error, "error");
      // El de este navegador: también se le quita la suscripción aquí.
      if (res.ok && hash === hereHash) {
        rememberPushHash(null);
        await (await currentPushSubscription().catch(() => null))?.unsubscribe().catch(() => {});
      }
      await refresh();
      if (res.ok) toast(t("Dispositivo quitado."), "success");
    });

  const savePrefs = () =>
    run(async () => {
      const res = await savePushPrefs(form);
      if (!res.ok) return toast(res.error, "error");
      setView((v) => ({ ...v, prefs: form }));
      toast(t("Preferencias guardadas"), "success");
    });

  // «Probar» prueba ESTE dispositivo (solo si está activado aquí).
  const test = () =>
    run(async () => {
      const res = await testPush({ hash: hereHash ?? undefined });
      if (!res.ok) return toast(res.error, "error");
      const { sent, failed, expired } = res.data;
      if (!sent || failed || expired) {
        toast(t("No se ha podido enviar el aviso de prueba a este dispositivo. Desactiva y vuelve a activar los avisos aquí."), "error");
        if (expired) await refresh();
        return;
      }
      const { os, browser } = notificationSettingsHint(navigator.userAgent);
      toast(
        os === "windows"
          ? t("Aviso de prueba enviado. Si no lo ves, mira Configuración de Windows → Sistema → Notificaciones → {browser}.", { browser })
          : os === "mac"
            ? t("Aviso de prueba enviado. Si no lo ves, mira Ajustes del Sistema → Notificaciones → {browser}.", { browser })
            : t("Aviso de prueba enviado. Si no lo ves, revisa los permisos de notificaciones del sistema."),
        "success",
      );
    });

  const note =
    support === "ios-install"
      ? t("En iPhone y iPad, los avisos solo funcionan con Pizarro instalado en la pantalla de inicio (iOS 16.4 o posterior): en Safari, Compartir → «Añadir a pantalla de inicio», y abre Pizarro desde ese icono.")
      : support === "insecure"
        ? t("Los avisos en el dispositivo necesitan que Pizarro se abra con https.")
        : support === "unsupported"
          ? t("Este navegador no admite avisos push. Prueba con Chrome, Edge, Firefox o Safari actualizados.")
          : permission === "denied"
            ? t("Has bloqueado las notificaciones de Pizarro en este navegador. Para activarlas, permítelas en la configuración del sitio (el candado junto a la dirección) y vuelve aquí.")
            : null;

  return (
    <section id="push" className="card space-y-4 p-5" data-testid="push-section">
      <div>
        <h2 className="flex items-center gap-2 font-semibold"><BellRing size={17} /> {t("Avisos en este dispositivo")}</h2>
        <p className="mt-0.5 text-sm text-slate-500">{t("Notificaciones del navegador o del móvil")}</p>
      </div>
      {note && <p role="status" className="text-sm text-amber-700 dark:text-amber-400" data-testid="push-note">{note}</p>}
      {support === "ok" && (
        <label className="flex items-center gap-2 text-sm font-medium">
          <input
            type="checkbox"
            role="switch"
            checked={here}
            disabled={pending || permission === "denied"}
            onChange={(e) => (e.target.checked ? turnOn() : turnOff())}
          />
          {t("Recibir avisos en este dispositivo")}
          {pending && <Loader2 size={15} className="animate-spin" />}
        </label>
      )}
      {view.devices.length > 0 && (
        <>
          <fieldset className="space-y-2">
            <legend className="mb-1 text-xs font-medium text-slate-500">{t("Qué avisos recibir en tus dispositivos")}</legend>
            {PREF_LABELS.map(({ key, label }) => (
              <label key={key} className="flex items-start gap-2 text-sm">
                <input type="checkbox" className="mt-0.5" name={`push-${key}`} checked={form[key]} onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.checked }))} />
                <span>{t(label)}</span>
              </label>
            ))}
          </fieldset>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn-primary py-1.5" onClick={savePrefs} disabled={pending || !dirty}>{t("Guardar")}</button>
            <button type="button" className="btn-secondary py-1.5" onClick={test} disabled={pending || !here}>{t("Probar")}</button>
          </div>
          {!here && <p className="text-xs text-slate-500" data-testid="push-test-hint">{t("Para probar los avisos, actívalos primero en este dispositivo.")}</p>}
          <div>
            <h3 className="text-xs font-medium text-slate-500">{t("Tus dispositivos con avisos ({n} de {max})", { n: view.devices.length, max: view.maxDevices })}</h3>
            <ul className="mt-1 divide-y divide-slate-200 dark:divide-slate-800">
              {view.devices.map((d) => (
                <li key={d.id} className="flex items-center gap-3 py-2">
                  <MonitorSmartphone size={18} className="shrink-0 text-slate-400" aria-hidden />
                  <div className="min-w-0 flex-1 text-sm">
                    <div className="flex flex-wrap items-center gap-2 font-medium">
                      {d.label}
                      {d.hash === hereHash && <span className="badge bg-brand-50 text-brand-700 ring-brand-500/20">{t("Este dispositivo")}</span>}
                    </div>
                    <div className="text-xs text-slate-500">
                      {t("Desde el {date} · servicio de {service}", { date: formatDate(d.createdAt, "date", locale), service: d.service })}
                      {d.lastSentAt ? ` · ${t("último aviso: {date}", { date: formatDate(d.lastSentAt, "dateTime", locale) })}` : ""}
                    </div>
                  </div>
                  <button type="button" className="btn-secondary px-2 py-1 text-xs" disabled={pending} onClick={() => remove(d.id, d.hash)}>{t("Quitar")}</button>
                </li>
              ))}
            </ul>
          </div>
        </>
      )}
    </section>
  );
}
