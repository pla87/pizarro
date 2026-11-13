"use client";

import { Check, Copy, Loader2, MessageCircle, Send, Smartphone } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { removeTelegramBot, saveTelegramBot, saveWhatsappSettings, setTelegramActive, setWhatsappActive, testTelegram, testWhatsapp } from "@/actions/messaging";
import { InfoTip } from "@/components/ui/InfoTip";
import { useToast } from "@/components/ui/Toast";
import { useT } from "@/i18n/client";
import type { MessagingAdminView } from "@/lib/messaging";
import { actionThrowResult } from "@/lib/stale-action";
import { codeTemplateAdminText } from "@/lib/whatsapp-code-text";

/**
 * «Telegram y WhatsApp»: el administrador activa los avisos por mensajería. Va en Ajustes, junto al email y Google (las
 * demás integraciones con credenciales), en lugar de en una pestaña propia. Los tokens se guardan cifrados y nunca vuelven
 * al navegador: solo se muestran sus 4 últimos caracteres.
 */
export function MessagingSettingsSection({ view }: { view: MessagingAdminView }) {
  const t = useT();
  return (
    <section id="mensajeria" className="card space-y-5 p-5">
      <div>
        <h2 className="flex items-center gap-1.5 text-base font-semibold"><Smartphone size={16} /> {t("3. Avisos por Telegram y WhatsApp")}</h2>
        <p className="mt-0.5 flex items-center gap-1 text-xs text-slate-500">
          {t("Los avisos también en el móvil. Telegram es gratis; WhatsApp lo cobra Meta por mensaje.")}
          <InfoTip topic={t("3. Avisos por Telegram y WhatsApp")}>{t("Tú activas cada canal aquí; luego cada persona lo conecta en Mi perfil → Avisos y elige qué avisos recibe (por defecto, menciones y asignaciones).")}</InfoTip>
        </p>
      </div>
      <TelegramAdmin view={view.telegram} />
      <WhatsappAdmin view={view.whatsapp} />
    </section>
  );
}

function Status({ active, children }: { active: boolean; children: React.ReactNode }) {
  return (
    <p className={active ? "rounded-md bg-emerald-50 p-3 text-xs text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-300" : "rounded-md bg-slate-50 p-3 text-xs text-slate-600 dark:bg-slate-800/50 dark:text-slate-300"}>
      {children}
    </p>
  );
}

/** Texto de la plantilla tal cual (con sus saltos de línea) y un botón para copiarlo. */
function TemplateBox({ label, value }: { label: string; value: string }) {
  const t = useT();
  const toast = useToast();
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast(t("No se pudo copiar. Selecciónala y cópiala a mano."), "error");
    }
  };
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-slate-500">{label}</span>
        <button type="button" className="btn-secondary px-2 py-1 text-xs" onClick={copy} aria-label={t("Copiar") + " " + label}>
          {copied ? <Check size={13} /> : <Copy size={13} />} {copied ? t("Copiada") : t("Copiar")}
        </button>
      </div>
      <pre className="whitespace-pre-wrap break-words rounded-md bg-slate-100 px-2 py-1.5 font-mono text-xs dark:bg-slate-800">{value}</pre>
    </div>
  );
}

function ErrorBox({ children }: { children: React.ReactNode }) {
  return <p role="alert" className="break-words rounded-md bg-red-50 p-2 text-xs text-red-700 dark:bg-red-950/40 dark:text-red-300">{children}</p>;
}

function TelegramAdmin({ view }: { view: MessagingAdminView["telegram"] }) {
  const t = useT();
  const toast = useToast();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [token, setToken] = useState("");
  const [replacing, setReplacing] = useState(!view.hasToken);
  const [error, setError] = useState<string | null>(null);

  const run = (fn: () => Promise<void>) =>
    start(async () => {
      setError(null);
      await fn();
      router.refresh();
    });

  const save = () =>
    run(async () => {
      const res = await saveTelegramBot({ token }).catch((e) => actionThrowResult(e, t));
      if (!res.ok) return setError(res.error);
      setToken("");
      setReplacing(false);
      // Guardado, pero Telegram falló al preparar el webhook o el sondeo: el aviso no puede ser verde.
      if (res.data.error) {
        setError(res.data.error);
        toast(t("Bot @{bot} guardado, pero Telegram ha respondido con un error al prepararlo.", { bot: res.data.bot }), "error");
      } else toast(t("Bot @{bot} guardado y activado.", { bot: res.data.bot }), "success");
      if (res.data.reset) toast(t("Has cambiado de bot: cada persona tiene que volver a conectar Telegram."), "success");
    });
  const toggle = (enabled: boolean) =>
    run(async () => {
      const res = await setTelegramActive(enabled).catch((e) => actionThrowResult(e, t));
      if (!res.ok) return setError(res.error);
      if (res.data.error) {
        setError(res.data.error);
        toast(enabled ? t("Avisos por Telegram activados, pero Telegram ha respondido con un error al preparar el bot.") : t("Avisos por Telegram desactivados, pero Telegram ha respondido con un error."), "error");
      } else toast(enabled ? t("Avisos por Telegram activados.") : t("Avisos por Telegram desactivados."), "success");
    });
  const test = () =>
    run(async () => {
      const res = await testTelegram().catch((e) => actionThrowResult(e, t));
      if (!res.ok) return setError(res.error);
      toast(res.data.sentToYou ? t("El bot @{bot} responde y te ha enviado un mensaje de prueba.", { bot: res.data.bot }) : t("El bot @{bot} responde. Conecta tu Telegram en Mi perfil → Avisos para recibir un mensaje de prueba.", { bot: res.data.bot }), "success");
    });
  const remove = () => {
    if (!confirm(t("¿Quitar el bot? Se borrará el token y todas las personas dejarán de recibir avisos por Telegram."))) return;
    run(async () => {
      const res = await removeTelegramBot().catch((e) => actionThrowResult(e, t));
      if (!res.ok) return setError(res.error);
      setReplacing(true);
      toast(t("Bot de Telegram quitado."), "success");
    });
  };

  const modeText =
    view.mode === "webhook"
      ? t("Telegram avisa a Pizarro al instante en {url}.", { url: view.webhookUrl ?? "" })
      : view.modeReason === "no-app-url"
        ? t("Falta APP_URL en el servidor: Pizarro preguntará a Telegram cada pocos segundos. Los enlaces de los avisos necesitan APP_URL.")
        : t("Pizarro pregunta a Telegram cada pocos segundos; funciona igual.");
  // Por qué no hay webhook: va en una nota «i» (la línea de estado se queda corta).
  const modeTip = view.mode !== "webhook" && view.modeReason !== "no-app-url"
    ? t("APP_URL no es una dirección https pública en un puerto que Telegram admita (443, 80, 88 u 8443). No hace falta abrir puertos; con https se usará el webhook solo.")
    : null;

  return (
    <div className="space-y-3 border-t border-slate-200 pt-4 dark:border-slate-800" data-testid="telegram-admin">
      <h3 className="flex items-center gap-1.5 text-sm font-semibold"><Send size={15} /> {t("Telegram (gratis)")}</h3>
      {view.active ? (
        <Status active>
          {t("Activo: bot @{bot}. {n} persona(s) conectada(s).", { bot: view.botUsername, n: view.connected })} {modeText}
          {modeTip && <>{" "}<InfoTip topic={t("Telegram (gratis)")}>{modeTip}</InfoTip></>}
        </Status>
      ) : (
        <Status active={false}>{view.hasToken ? t("Desactivado: el bot @{bot} está guardado, pero no se envían avisos.", { bot: view.botUsername }) : t("Inactivo: crea un bot y pega aquí su token.")}</Status>
      )}
      {(view.lastError || view.deliveryError) && <ErrorBox>{t("Telegram ha respondido con un error:")} {view.lastError ?? view.deliveryError}</ErrorBox>}

      <details className="text-xs text-slate-600 dark:text-slate-300" open={!view.hasToken}>
        <summary className="cursor-pointer font-medium">{t("Cómo crear el bot (2 minutos)")}</summary>
        <ol className="mt-2 list-decimal space-y-1 pl-5">
          <li>{t("En Telegram, abre @BotFather y escribe /newbot.")}</li>
          <li>{t("Elige un nombre (p. ej. «Avisos de Pizarro») y un usuario que termine en «bot» (p. ej. pizarro_avisos_bot).")}</li>
          <li>{t("BotFather te da un token del tipo 123456789:AA…; cópialo y pégalo aquí.")}</li>
          <li>{t("Pulsa «Guardar y activar» y después «Probar».")}</li>
        </ol>
      </details>

      <div className="block text-sm sm:max-w-md">
        <div className="flex items-center gap-1">
          <label htmlFor="tg-token" className="font-medium">{t("Token del bot")}</label>
          <InfoTip topic={t("Token del bot")}>{t("El token se guarda cifrado y no se vuelve a mostrar.")}</InfoTip>
        </div>
        {view.hasToken && !replacing ? (
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <span className="rounded-md bg-slate-100 px-2 py-1 text-xs dark:bg-slate-800">{view.tokenLast4 ? t("configurado (…{last4})", { last4: view.tokenLast4 }) : t("configurado")}</span>
            <button type="button" className="btn-secondary px-2 py-1 text-xs" onClick={() => setReplacing(true)}>{t("Reemplazar")}</button>
          </div>
        ) : (
          <input id="tg-token" className="input mt-1 w-full font-mono" type="password" value={token} onChange={(e) => setToken(e.target.value.trim())} autoComplete="off" spellCheck={false} maxLength={100} placeholder="123456789:AA…" />
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {(replacing || !view.hasToken) && (
          <button className="btn-primary py-1.5" onClick={save} disabled={pending || token === ""}>
            {pending && <Loader2 size={15} className="animate-spin" />} {t("Guardar y activar")}
          </button>
        )}
        {view.hasToken && replacing && <button className="btn-secondary py-1.5" onClick={() => { setReplacing(false); setToken(""); }} disabled={pending}>{t("Cancelar")}</button>}
        {view.hasToken && !replacing && (
          <>
            <button className="btn-secondary py-1.5" onClick={test} disabled={pending}>{pending && <Loader2 size={15} className="animate-spin" />} {t("Probar")}</button>
            {view.enabled
              ? <button className="btn-secondary py-1.5" onClick={() => toggle(false)} disabled={pending}>{t("Desactivar")}</button>
              : <button className="btn-primary py-1.5" onClick={() => toggle(true)} disabled={pending}>{t("Activar")}</button>}
            <button className="btn-secondary py-1.5" onClick={remove} disabled={pending}>{t("Quitar el bot")}</button>
          </>
        )}
      </div>
      {error && <ErrorBox>{error}</ErrorBox>}
    </div>
  );
}

function WhatsappAdmin({ view }: { view: MessagingAdminView["whatsapp"] }) {
  const t = useT();
  const toast = useToast();
  const router = useRouter();
  const [pending, start] = useTransition();
  const initial = {
    phoneNumberId: view.phoneNumberId, templateName: view.templateName, templateLang: view.templateLang, templateLangEn: view.templateLangEn,
    codeTemplateName: view.codeTemplateName, codeTemplateLang: view.codeTemplateLang, codeTemplateLangEn: view.codeTemplateLangEn,
  };
  const [form, setForm] = useState(initial);
  const [saved, setSaved] = useState(initial);
  const [token, setToken] = useState("");
  const [replacing, setReplacing] = useState(!view.hasSavedToken);
  const [clearToken, setClearToken] = useState(false);
  const [to, setTo] = useState("");
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof typeof form>(k: K, v: string) => setForm((f) => ({ ...f, [k]: v }));
  const dirty = (Object.keys(form) as (keyof typeof form)[]).some((k) => form[k].trim() !== saved[k]) || token !== "" || clearToken;

  const run = (fn: () => Promise<void>) =>
    start(async () => {
      setError(null);
      await fn();
      router.refresh();
    });
  const save = () =>
    run(async () => {
      const res = await saveWhatsappSettings({ ...form, token, clearToken }).catch((e) => actionThrowResult(e, t));
      if (!res.ok) return setError(res.error);
      setSaved(Object.fromEntries(Object.entries(form).map(([k, v]) => [k, v.trim()])) as typeof form);
      setToken("");
      setClearToken(false);
      setReplacing(false);
      // La primera vez no se activa sola (cada aviso cuesta dinero): se activa con «Activar».
      toast(res.data.complete && !res.data.active ? t("Configuración de WhatsApp guardada. Pulsa «Activar» para empezar a enviar avisos (de pago).") : t("Configuración de WhatsApp guardada."), "success");
    });
  const toggle = (enabled: boolean) =>
    run(async () => {
      const res = await setWhatsappActive(enabled).catch((e) => actionThrowResult(e, t));
      if (!res.ok) return setError(res.error);
      toast(enabled ? t("Avisos por WhatsApp activados.") : t("Avisos por WhatsApp desactivados."), "success");
    });
  const test = () =>
    run(async () => {
      const res = await testWhatsapp({ to }).catch((e) => actionThrowResult(e, t));
      if (!res.ok) return setError(res.error);
      const { noticeError, codeError } = res.data;
      if (noticeError || codeError) {
        // Una de las dos ha salido: se dice cuál y por qué falla la otra.
        setError([
          noticeError && `${t("Plantilla de avisos:")} ${noticeError}`,
          codeError && `${t("Plantilla de verificación:")} ${codeError}`,
        ].filter(Boolean).join(" "));
        toast(noticeError ? t("Solo ha salido el código de verificación de prueba.") : t("Solo ha salido el aviso de prueba."), "error");
      } else toast(t("Enviados 2 WhatsApp de prueba a {to}: un aviso y un código de verificación de muestra (123456).", { to: res.data.to }), "success");
    });

  const envHint = (name: string, value: string) => (value ? t("Vacío = {value} (variable {name} del servidor)", { value, name }) : "");

  return (
    <div className="space-y-3 border-t border-slate-200 pt-4 dark:border-slate-800" data-testid="whatsapp-admin">
      <h3 className="flex items-center gap-1.5 text-sm font-semibold"><MessageCircle size={15} /> {t("WhatsApp (de pago, Cloud API de Meta)")}</h3>
      {view.active ? (
        <Status active>{t("Activo: {n} persona(s) conectada(s) y {p} pendiente(s) de confirmar su número.", { n: view.connected, p: view.pending })}</Status>
      ) : (
        <Status active={false}>{view.complete ? t("Desactivado: la configuración está completa, pero no se envían avisos.") : t("Inactivo: faltan el token, el identificador del número o la plantilla.")}</Status>
      )}
      <p className="text-xs text-slate-500">
        {t("Meta cobra cada aviso entregado (plantilla de utilidad: unos céntimos por mensaje según el país).")}{" "}
        <a className="underline" href={view.pricingUrl} target="_blank" rel="noopener noreferrer">{t("Precios de Meta")}</a>
      </p>
      {view.legacy && (
        <p className="text-xs text-amber-600">
          {view.legacyFromEnv
            ? t("La plantilla sale de la variable WHATSAPP_TEMPLATE_NAME: se usa el formato antiguo (4 variables) y solo se envían menciones. Si tu plantilla ya es la nueva (3 variables, abajo), escribe su nombre en «Nombre de la plantilla» y guarda.")
            : t("Usas la plantilla antigua mencion_pizarro: solo se envían menciones. Crea aviso_pizarro (abajo) para enviar todos los tipos de aviso.")}
        </p>
      )}

      <details className="text-xs text-slate-600 dark:text-slate-300" open={!view.complete}>
        <summary className="cursor-pointer font-medium">{t("Qué necesitas de Meta")}</summary>
        <ol className="mt-2 list-decimal space-y-1 pl-5">
          <li>{t("Una app de tipo Empresa en developers.facebook.com con el producto WhatsApp y un número de teléfono.")}</li>
          <li>{t("Un token permanente de un usuario del sistema (Configuración del negocio → Usuarios del sistema) con el permiso whatsapp_business_messaging.")}</li>
          <li>{t("El identificador del número (Phone number ID) de WhatsApp → Configuración de la API.")}</li>
          <li>{t("Una plantilla de categoría Utilidad llamada aviso_pizarro, aprobada, con este texto exacto:")}</li>
        </ol>
        <div className="mt-2 space-y-2">
          <TemplateBox label={t("Español (es)")} value={view.templateBody.es} />
          <TemplateBox label={t("Inglés (en), opcional")} value={view.templateBody.en} />
        </div>
        <ol start={5} className="mt-2 list-decimal space-y-1 pl-5">
          <li>{t("Una plantilla de categoría Autenticación llamada codigo_pizarro, aprobada, con la opción «Copiar código» y el mismo idioma. Su texto lo pone Meta («Tu código de verificación es…»): con ella llega el código para conectar WhatsApp.")}</li>
        </ol>
      </details>
      {view.codeTemplateError && !error && (
        <ErrorBox>{codeTemplateAdminText(t, view.codeTemplateError.problem, view.codeTemplateError)}</ErrorBox>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="block text-sm">
          <div className="flex items-center gap-1">
            <label htmlFor="wa-token" className="font-medium">{t("Token de acceso")}</label>
            <InfoTip topic={t("Token de acceso")}>{t("El token se guarda cifrado y no se vuelve a mostrar.")}</InfoTip>
          </div>
          {view.hasSavedToken && !replacing && !clearToken ? (
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <span className="rounded-md bg-slate-100 px-2 py-1 text-xs dark:bg-slate-800">{view.tokenLast4 ? t("configurado (…{last4})", { last4: view.tokenLast4 }) : t("configurado")}</span>
              <button type="button" className="btn-secondary px-2 py-1 text-xs" onClick={() => setReplacing(true)}>{t("Reemplazar")}</button>
              <button type="button" className="btn-secondary px-2 py-1 text-xs" onClick={() => setClearToken(true)}>{t("Quitar")}</button>
            </div>
          ) : clearToken ? (
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <span className="text-xs text-slate-500">{t("Se quitará al guardar.")}</span>
              <button type="button" className="btn-secondary px-2 py-1 text-xs" onClick={() => setClearToken(false)}>{t("Cancelar")}</button>
            </div>
          ) : (
            <input id="wa-token" className="input mt-1 w-full font-mono" type="password" value={token} onChange={(e) => setToken(e.target.value.trim())} autoComplete="off" spellCheck={false} maxLength={2000} placeholder={view.env.token ? t("Vacío = variable WHATSAPP_TOKEN del servidor") : "EAAG…"} />
          )}
        </div>
        <label className="block text-sm">
          <span className="font-medium">{t("Identificador del número (Phone number ID)")}</span>
          <input className="input mt-1 w-full" inputMode="numeric" value={form.phoneNumberId} onChange={(e) => set("phoneNumberId", e.target.value)} maxLength={30} placeholder={view.env.phoneNumberId || "123456789012345"} />
          {!form.phoneNumberId && <span className="mt-0.5 block text-xs text-slate-500">{envHint("WHATSAPP_PHONE_NUMBER_ID", view.env.phoneNumberId)}</span>}
        </label>
        <label className="block text-sm">
          <span className="font-medium">{t("Nombre de la plantilla")}</span>
          <input className="input mt-1 w-full" value={form.templateName} onChange={(e) => set("templateName", e.target.value)} maxLength={512} placeholder={view.env.templateName || view.defaultTemplate} />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="block text-sm">
            <span className="font-medium">{t("Idioma")}</span>
            <input className="input mt-1 w-full" value={form.templateLang} onChange={(e) => set("templateLang", e.target.value)} maxLength={10} placeholder={view.env.templateLang || "es"} />
          </label>
          <label className="block text-sm">
            <span className="font-medium">{t("Idioma en inglés")}</span>
            <input className="input mt-1 w-full" value={form.templateLangEn} onChange={(e) => set("templateLangEn", e.target.value)} maxLength={10} placeholder={t("opcional, p. ej. en")} />
          </label>
        </div>
        <label className="block text-sm">
          <span className="font-medium">{t("Plantilla de verificación")}</span>
          <input className="input mt-1 w-full" value={form.codeTemplateName} onChange={(e) => set("codeTemplateName", e.target.value)} maxLength={512} placeholder={view.defaultCodeTemplate} />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="block text-sm">
            <span className="font-medium">{t("Idioma de la verificación")}</span>
            <input className="input mt-1 w-full" value={form.codeTemplateLang} onChange={(e) => set("codeTemplateLang", e.target.value)} maxLength={10} placeholder={form.templateLang.trim() || view.effective.templateLang || "es"} />
          </label>
          <label className="block text-sm">
            <span className="font-medium">{t("Idioma en inglés de la verificación")}</span>
            <input className="input mt-1 w-full" value={form.codeTemplateLangEn} onChange={(e) => set("codeTemplateLangEn", e.target.value)} maxLength={10} placeholder={t("opcional, p. ej. en")} />
          </label>
        </div>
      </div>
      <p className="flex flex-wrap items-center gap-1 text-xs text-slate-500">
        {t("Lo que guardas aquí manda; los campos vacíos usan las variables WHATSAPP_* del servidor, si las hay.")}
        <InfoTip topic={t("Plantilla de verificación")}>{t("Lleva el código de 6 cifras con el que cada persona conecta su WhatsApp; Meta exige la categoría Autenticación (no vale aviso_pizarro). Vacía = codigo_pizarro, en el idioma de los avisos.")}</InfoTip>
        <InfoTip topic={t("Idioma en inglés")}>{t("Los idiomas en inglés se usan con quien tiene Pizarro en inglés (añade esa traducción a la plantilla en Meta). Vacíos, todos reciben el idioma principal.")}</InfoTip>
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <button className="btn-primary py-1.5" onClick={save} disabled={pending || !dirty}>
          {pending && <Loader2 size={15} className="animate-spin" />} {t("Guardar")}
        </button>
        {view.complete && (view.enabled
          ? <button className="btn-secondary py-1.5" onClick={() => toggle(false)} disabled={pending}>{t("Desactivar")}</button>
          : <button className="btn-primary py-1.5" onClick={() => toggle(true)} disabled={pending || dirty}>{t("Activar")}</button>)}
      </div>

      <div className="space-y-2 border-t border-slate-200 pt-3 dark:border-slate-700">
        <div className="flex flex-wrap items-center gap-2">
          <input className="input w-48" type="tel" inputMode="tel" value={to} onChange={(e) => setTo(e.target.value)} placeholder="+34600111222" aria-label={t("Número para la prueba")} maxLength={25} />
          <button className="btn-secondary py-1.5" onClick={test} disabled={pending || dirty || !view.complete || !to.trim()}>
            {pending && <Loader2 size={15} className="animate-spin" />} {t("Probar")}
          </button>
          <span className="flex items-center gap-1 text-xs text-slate-500">
            {dirty ? t("Guarda los cambios antes de enviar la prueba.") : t("Envía 2 mensajes de pago: un aviso de prueba y un código de muestra.")}
            {!dirty && <InfoTip topic={t("Probar")}>{t("Con el número de prueba de Meta, solo llegan a los números verificados.")}</InfoTip>}
          </span>
        </div>
      </div>
      {error && <ErrorBox>{error}</ErrorBox>}
    </div>
  );
}
