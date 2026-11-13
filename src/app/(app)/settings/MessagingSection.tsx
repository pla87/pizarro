"use client";

import { Loader2, MessageCircle, Send, Smartphone } from "lucide-react";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import {
  confirmMyWhatsapp, connectTelegram, disconnectChannel, myChannels, resendMyWhatsappCode, saveChannelPrefs, saveMyWhatsapp, testMyChannel,
} from "@/actions/messaging";
import { InfoTip } from "@/components/ui/InfoTip";
import { useToast } from "@/components/ui/Toast";
import { useT } from "@/i18n/client";
import type { ChannelPrefs } from "@/lib/messaging-core";
import type { MyChannelsView } from "@/lib/messaging";
import { actionThrowResult } from "@/lib/stale-action";
import { telegramWaitState } from "@/lib/telegram-wait";
import { codeTemplateUserText } from "@/lib/whatsapp-code-text";

type Channel = "TELEGRAM" | "WHATSAPP";

/** Mi perfil → Avisos: Telegram y WhatsApp (solo los que el administrador ha activado, o los que la persona ya tenía). */
export function MessagingSection({ initial }: { initial: MyChannelsView }) {
  const t = useT();
  const [view, setView] = useState(initial);
  const refresh = useCallback(async () => {
    const res = await myChannels().catch(() => null);
    if (res?.ok) setView(res.data);
    return res?.ok ? res.data : null;
  }, []);
  if (!view.telegram && !view.whatsapp) return null;
  return (
    <section id="mensajeria" className="card space-y-5 p-5">
      <div>
        <h2 className="flex items-center gap-2 font-semibold"><Smartphone size={17} /> {t("Avisos en el móvil: Telegram y WhatsApp")}</h2>
        <p className="mt-0.5 text-sm text-slate-500">{t("Recibe tus avisos en el móvil. En cada canal eliges qué avisos quieres; por defecto, solo menciones y asignaciones.")}</p>
      </div>
      {view.telegram && <TelegramBlock view={view.telegram} refresh={refresh} />}
      {view.whatsapp && <WhatsappBlock view={view.whatsapp} refresh={refresh} />}
    </section>
  );
}

function TelegramBlock({ view, refresh }: { view: NonNullable<MyChannelsView["telegram"]>; refresh: () => Promise<MyChannelsView | null> }) {
  const t = useT();
  const toast = useToast();
  const [pending, start] = useTransition();
  const [link, setLink] = useState<{ url: string; qr: string; expiresAt: string; bot: string } | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  // Mientras el enlace está abierto se pregunta cada 3 s si ya se ha conectado (hasta que caduca). Si el enlace deja de
  // valer (el administrador cambia o quita el bot, o se pide otro enlace en otra pestaña), se deja de esperar con un aviso.
  useEffect(() => {
    if (!link) return;
    const until = new Date(link.expiresAt).getTime();
    let stale = 0;
    timer.current = setInterval(async () => {
      if (Date.now() > until) {
        setLink(null);
        return;
      }
      const v = await refresh();
      if (!v) return; // sin respuesta (red): se sigue esperando
      const state = telegramWaitState(link, v.telegram);
      if (state === "connected") {
        setLink(null);
        toast(t("Telegram conectado."), "success");
        return;
      }
      // Sin código pendiente puede ser el instante en que se gasta (justo antes de conectar): se confirma en la siguiente consulta.
      stale = state === "stale" ? stale + 1 : 0;
      if (state === "botChanged" || stale >= 2) {
        setLink(null);
        toast(t("Este enlace ya no vale: el administrador ha cambiado el bot de Telegram o se ha pedido otro enlace. Vuelve a pulsar «Conectar Telegram»."), "error");
      }
    }, 3_000);
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, [link, refresh, t, toast]);

  const connect = () =>
    start(async () => {
      const res = await connectTelegram().catch((e) => actionThrowResult(e, t));
      if (!res.ok) return toast(res.error, "error");
      setLink(res.data);
    });

  return (
    <div className="space-y-3 border-t border-slate-200 pt-4 first-of-type:border-0 dark:border-slate-800">
      <h3 className="flex items-center gap-1.5 text-sm font-semibold"><Send size={15} /> Telegram</h3>
      {!view.available && (
        <p className="text-xs text-amber-600">{t("El administrador ha desactivado los avisos por Telegram: ahora no te llegarán.")}</p>
      )}
      {view.connected ? (
        <>
          <p className="text-sm">{view.label ? t("Conectado como {name}.", { name: view.label }) : t("Conectado.")}</p>
          <ChannelControls channel="TELEGRAM" prefs={view.prefs} canTest={view.available} refresh={refresh} />
        </>
      ) : link ? (
        <div className="space-y-3 rounded-lg bg-slate-50 p-3 text-sm dark:bg-slate-800/50">
          <p>{t("Abre el enlace en el móvil (o escanea el código con la cámara) y pulsa «Iniciar» en Telegram. El enlace sirve una sola vez y caduca en 10 minutos.")}</p>
          <div className="flex flex-wrap items-center gap-4">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={link.qr} alt={t("Código QR para conectar Telegram")} width={132} height={132} className="rounded bg-white p-1" />
            <div className="space-y-2">
              <a href={link.url} target="_blank" rel="noopener noreferrer" className="btn-primary inline-flex">{t("Abrir Telegram")}</a>
              <p className="flex items-center gap-1.5 text-xs text-slate-500"><Loader2 size={13} className="animate-spin" /> {t("Esperando a que pulses «Iniciar»…")}</p>
              <button type="button" className="btn-secondary px-2 py-1 text-xs" onClick={() => setLink(null)}>{t("Cancelar")}</button>
            </div>
          </div>
        </div>
      ) : view.available ? (
        <div className="space-y-2">
          <p className="text-sm text-slate-500">{t("Gratis. Necesitas la app de Telegram en el móvil o en el ordenador.")}</p>
          <button type="button" className="btn-primary" onClick={connect} disabled={pending}>
            {pending && <Loader2 size={15} className="animate-spin" />} {t("Conectar Telegram")}
          </button>
        </div>
      ) : null}
    </div>
  );
}

function WhatsappBlock({ view, refresh }: { view: NonNullable<MyChannelsView["whatsapp"]>; refresh: () => Promise<MyChannelsView | null> }) {
  const t = useT();
  const toast = useToast();
  const [pending, start] = useTransition();
  // Un número sin consentimiento (de una versión anterior, con WhatsApp desactivado) se muestra en el formulario.
  const [editing, setEditing] = useState(!view.phone || !view.consented);
  const [phone, setPhone] = useState(view.phone);
  const [consent, setConsent] = useState(false);
  const [code, setCode] = useState("");

  const save = () =>
    start(async () => {
      const res = await saveMyWhatsapp({ phone, consent }).catch((e) => actionThrowResult(e, t));
      if (!res.ok) {
        // Puede que el número sí se haya guardado y fallara el envío del código: se muestra cómo ha quedado.
        const v = await refresh();
        if (v?.whatsapp?.phone && v.whatsapp.consented && !v.whatsapp.verified) setEditing(false);
        return toast(res.error, "error");
      }
      await refresh();
      setEditing(false);
      setConsent(false);
      setCode("");
      toast(res.data.sent ? t("Te hemos enviado un código por WhatsApp.") : t("Número guardado."), "success");
    });

  const confirm = () =>
    start(async () => {
      const res = await confirmMyWhatsapp({ code }).catch((e) => actionThrowResult(e, t));
      if (!res.ok) {
        await refresh();
        return toast(res.error, "error");
      }
      setCode("");
      await refresh();
      toast(t("WhatsApp conectado."), "success");
    });

  const resend = () =>
    start(async () => {
      const res = await resendMyWhatsappCode().catch((e) => actionThrowResult(e, t));
      if (res.ok) {
        setCode("");
        await refresh();
      }
      toast(res.ok ? t("Te hemos enviado otro código por WhatsApp.") : res.error, res.ok ? "success" : "error");
    });

  const forget = () =>
    start(async () => {
      const res = await disconnectChannel("WHATSAPP").catch((e) => actionThrowResult(e, t));
      if (!res.ok) return toast(res.error, "error");
      setPhone("");
      await refresh();
      toast(t("Número borrado."), "success");
    });

  return (
    <div className="space-y-3 border-t border-slate-200 pt-4 first-of-type:border-0 dark:border-slate-800">
      <h3 className="flex items-center gap-1.5 text-sm font-semibold"><MessageCircle size={15} /> WhatsApp</h3>
      {!view.available && (
        <p className="text-xs text-amber-600">{t("El administrador ha desactivado los avisos por WhatsApp: ahora no te llegarán.")}</p>
      )}
      {view.available && view.codeBlocked && !view.verified && (
        <p role="status" className="text-xs text-amber-600" data-testid="wa-code-blocked">{codeTemplateUserText(t)}</p>
      )}
      {editing && view.available ? (
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
        >
          {view.phone && !view.consented && (
            <p className="text-xs text-slate-500">{t("Los avisos por WhatsApp no están activados en este número: acepta recibirlos y confírmalo con el código que te enviaremos.")}</p>
          )}
          <div className="max-w-xs">
            <label className="label" htmlFor="wa-phone">{t("Número de WhatsApp (formato internacional)")}</label>
            <input id="wa-phone" type="tel" inputMode="tel" className="input" placeholder="+34600111222" value={phone} onChange={(e) => setPhone(e.target.value)} autoComplete="tel" maxLength={25} />
          </div>
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" className="mt-0.5" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
            <span>{t("Acepto recibir avisos de Pizarro por WhatsApp en este número. Puedo dejar de recibirlos cuando quiera desde aquí.")}</span>
          </label>
          <div className="flex flex-wrap gap-2">
            <button className="btn-primary" disabled={pending || !consent || !phone.trim()}>
              {pending && <Loader2 size={15} className="animate-spin" />} {t("Guardar y enviar código")}
            </button>
            {view.phone && view.consented && <button type="button" className="btn-secondary" onClick={() => { setEditing(false); setPhone(view.phone); }}>{t("Cancelar")}</button>}
            {view.phone && !view.consented && <button type="button" className="btn-secondary" onClick={forget} disabled={pending}>{t("Borrar el número")}</button>}
          </div>
        </form>
      ) : view.phone && view.consented && !view.verified ? (
        <form
          className="space-y-2 rounded-lg bg-slate-50 p-3 text-sm dark:bg-slate-800/50"
          onSubmit={(e) => {
            e.preventDefault();
            confirm();
          }}
        >
          <p>
            {view.codePending
              ? t("Te hemos enviado un código de 6 cifras por WhatsApp a {phone}. Escríbelo aquí para confirmar que el número es tuyo.", { phone: view.phone })
              : view.codeBlocked
                ? t("Todavía no se ha podido enviar el código a {phone}. Cuando el administrador lo arregle, pulsa «Enviar otro código».", { phone: view.phone })
                : t("El código enviado a {phone} ha caducado o ya no vale. Pide otro.", { phone: view.phone })}
          </p>
          {view.codePending && (
            <div className="max-w-[10rem]">
              <label className="label" htmlFor="wa-code">{t("Código de WhatsApp")}</label>
              <input
                id="wa-code"
                className="input tracking-widest"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9 ]*"
                maxLength={7}
                placeholder="123456"
                value={code}
                onChange={(e) => setCode(e.target.value)}
              />
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            {view.codePending && (
              <button className="btn-primary py-1.5" disabled={pending || code.replace(/\D/g, "").length !== 6}>
                {pending && <Loader2 size={15} className="animate-spin" />} {t("Confirmar")}
              </button>
            )}
            <button type="button" className="btn-secondary py-1.5" onClick={resend} disabled={pending || !view.available}>{t("Enviar otro código")}</button>
            <button type="button" className="btn-secondary py-1.5" onClick={() => setEditing(true)} disabled={pending || !view.available}>{t("Cambiar número")}</button>
          </div>
          <p className="flex items-center gap-1 text-xs text-slate-500">
            {t("Caduca a los 15 minutos. Si no llega, revisa el número.")}
            <InfoTip topic={t("Código de WhatsApp")}>{t("Admite 5 intentos. Hasta confirmarlo no recibes avisos por WhatsApp; si sigue sin llegar, pide al administrador que revise la configuración.")}</InfoTip>
          </p>
        </form>
      ) : view.phone && view.verified ? (
        <>
          <p className="flex flex-wrap items-center gap-2 text-sm">
            {t("Conectado: {phone}.", { phone: view.phone })}
            {view.available && <button type="button" className="btn-secondary px-2 py-1 text-xs" onClick={() => setEditing(true)}>{t("Cambiar número")}</button>}
          </p>
          {view.mentionsOnly && <p className="text-xs text-slate-500">{t("Con la plantilla de WhatsApp que usa esta instalación solo se envían las menciones.")}</p>}
          <ChannelControls channel="WHATSAPP" prefs={view.prefs} canTest={view.available} mentionsOnly={view.mentionsOnly} refresh={refresh} />
        </>
      ) : view.phone ? (
        <p className="flex flex-wrap items-center gap-2 text-sm text-slate-500">
          {t("Número guardado: {phone}. Los avisos por WhatsApp no están activados.", { phone: view.phone })}
          <button type="button" className="btn-secondary px-2 py-1 text-xs" onClick={forget} disabled={pending}>{t("Borrar el número")}</button>
        </p>
      ) : null}
      {editing && view.available && <p className="text-xs text-slate-500">{t("WhatsApp le cuesta dinero a tu organización por cada mensaje: actívalo solo si lo vas a usar.")}</p>}
    </div>
  );
}

const PREF_LABELS: { key: keyof ChannelPrefs; label: string }[] = [
  { key: "notifyMention", label: "Menciones (@)" },
  { key: "notifyAssigned", label: "Tareas que me asignan" },
  { key: "notifyComment", label: "Comentarios y respuestas en tareas que sigo" },
  { key: "notifyDue", label: "Cambios de fecha límite y recordatorios de «Esperando»" },
];

function ChannelControls({ channel, prefs, canTest, mentionsOnly, refresh }: { channel: Channel; prefs: ChannelPrefs; canTest: boolean; mentionsOnly?: boolean; refresh: () => Promise<MyChannelsView | null> }) {
  const t = useT();
  const toast = useToast();
  const [pending, start] = useTransition();
  const [form, setForm] = useState(prefs);
  const dirty = PREF_LABELS.some(({ key }) => form[key] !== prefs[key]);
  const id = channel.toLowerCase();

  const save = () =>
    start(async () => {
      const res = await saveChannelPrefs(channel, form).catch((e) => actionThrowResult(e, t));
      if (!res.ok) return toast(res.error, "error");
      await refresh();
      toast(t("Preferencias guardadas"), "success");
    });
  const test = () =>
    start(async () => {
      const res = await testMyChannel(channel).catch((e) => actionThrowResult(e, t));
      toast(res.ok ? t("Mensaje de prueba enviado.") : res.error, res.ok ? "success" : "error");
      // Si falló porque el bot está bloqueado, el servidor ha desconectado Telegram: se muestra ya desconectado.
      if (!res.ok) await refresh();
    });
  const disconnect = () =>
    start(async () => {
      const res = await disconnectChannel(channel).catch((e) => actionThrowResult(e, t));
      if (!res.ok) return toast(res.error, "error");
      await refresh();
      toast(channel === "TELEGRAM" ? t("Telegram desconectado.") : t("WhatsApp desconectado."), "success");
    });

  return (
    <div className="space-y-3">
      <fieldset className="space-y-2">
        <legend className="mb-1 text-xs font-medium text-slate-500">{t("Qué avisos recibir por aquí")}</legend>
        {PREF_LABELS.map(({ key, label }) => (
          <label key={key} className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              className="mt-0.5"
              name={`${id}-${key}`}
              checked={mentionsOnly && key !== "notifyMention" ? false : form[key]}
              disabled={mentionsOnly && key !== "notifyMention"}
              onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.checked }))}
            />
            <span>{t(label)}</span>
          </label>
        ))}
      </fieldset>
      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn-primary py-1.5" onClick={save} disabled={pending || !dirty}>
          {pending && <Loader2 size={15} className="animate-spin" />} {t("Guardar")}
        </button>
        <button type="button" className="btn-secondary py-1.5" onClick={test} disabled={pending || !canTest}>{t("Enviar mensaje de prueba")}</button>
        <button type="button" className="btn-secondary py-1.5" onClick={disconnect} disabled={pending}>{t("Desconectar")}</button>
      </div>
    </div>
  );
}
