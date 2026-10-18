"use client";

import { Bell, Eye, Link2, Pencil } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { changePassword, disconnectGoogle, updateNotificationPrefs, updateProfileName, updateReleaseTemplates } from "@/actions/profile";
import { cn } from "@/components/ui/cn";
import { Markdown } from "@/components/ui/Markdown";
import { useToast } from "@/components/ui/Toast";
import { buildReleaseMarkdown, isoDate } from "@/lib/release";

interface Props {
  name: string;
  email: string;
  header: string;
  footer: string;
  notifications: {
    notifyEmail: boolean;
    notifyWhatsapp: boolean;
    whatsappPhone: string;
    emailAvailable: boolean;
    whatsappAvailable: boolean;
  };
  google: { enabled: boolean; email: string | null; message: { ok: boolean; text: string } | null };
}

const SAMPLE_TASKS = [
  { title: "Ejemplo de nueva funcionalidad", type: "FEATURE" as const, linkUrl: "https://example.com/pr/1" },
  { title: "Ejemplo de corrección", type: "FIX" as const },
  { title: "Ejemplo de tarea de mantenimiento", type: "CHORE" as const },
];

export function ProfileSettings(props: Props) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const [name, setName] = useState(props.name);
  const [header, setHeader] = useState(props.header);
  const [footer, setFooter] = useState(props.footer);
  const [preview, setPreview] = useState(false);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [repeat, setRepeat] = useState("");

  return (
    <div className="mx-auto max-w-3xl space-y-5 p-4 md:p-6">
      <h1 className="text-xl font-semibold">Mi perfil y plantillas</h1>

      <section className="card p-5">
        <h2 className="font-semibold">Plantillas de release notes</h2>
        <p className="mt-0.5 text-sm text-slate-500">
          Se insertan automáticamente al principio y al final de cada release que generes. Admiten Markdown.
        </p>
        <div className="mt-4 flex items-center gap-1 rounded-lg bg-slate-100 p-1 text-sm dark:bg-slate-800">
          {[false, true].map((p) => (
            <button
              key={String(p)}
              onClick={() => setPreview(p)}
              className={cn("flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-1.5 font-medium", preview === p ? "bg-white shadow-sm dark:bg-slate-900" : "text-slate-500")}
            >
              {p ? <><Eye size={14} /> Vista previa de una release</> : <><Pencil size={14} /> Editar</>}
            </button>
          ))}
        </div>
        {preview ? (
          <div className="mt-3 rounded-lg border border-slate-200 p-4 dark:border-slate-800">
            <Markdown>{buildReleaseMarkdown({ header, footer, title: `Release ${isoDate()} · Proyecto`, tasks: SAMPLE_TASKS })}</Markdown>
          </div>
        ) : (
          <div className="mt-3 space-y-4">
            <div>
              <label className="label" htmlFor="tpl-header">Cabecera estándar</label>
              <textarea
                id="tpl-header"
                className="input field-sizing-content min-h-28 font-mono text-[13px]"
                value={header}
                onChange={(e) => setHeader(e.target.value)}
                maxLength={20000}
                placeholder={"Ej.: instrucciones de contexto para una IA, o una introducción fija.\n\n> Resume estos cambios para el equipo de negocio en lenguaje no técnico."}
              />
            </div>
            <div>
              <label className="label" htmlFor="tpl-footer">Pie estándar</label>
              <textarea
                id="tpl-footer"
                className="input field-sizing-content min-h-28 font-mono text-[13px]"
                value={footer}
                onChange={(e) => setFooter(e.target.value)}
                maxLength={20000}
                placeholder={"Ej.: checklist de validación.\n\n- [ ] Migraciones aplicadas\n- [ ] Smoke test en producción"}
              />
            </div>
          </div>
        )}
        <button
          className="btn-primary mt-4"
          disabled={pending}
          onClick={() =>
            start(async () => {
              const res = await updateReleaseTemplates(header, footer);
              toast(res.ok ? "Plantillas guardadas" : res.error, res.ok ? "success" : "error");
            })
          }
        >
          Guardar plantillas
        </button>
      </section>

      <GoogleSection google={props.google} />
      <NotificationSection prefs={props.notifications} />

      <section className="card p-5">
        <h2 className="font-semibold">Perfil</h2>
        <form
          className="mt-4 space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            start(async () => {
              const res = await updateProfileName(name);
              toast(res.ok ? "Perfil actualizado" : res.error, res.ok ? "success" : "error");
              if (res.ok) router.refresh();
            });
          }}
        >
          <div>
            <div className="label">Email</div>
            <p className="text-sm">{props.email}</p>
          </div>
          <div>
            <label className="label" htmlFor="pf-name">Nombre visible</label>
            <input id="pf-name" className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} required />
          </div>
          <button className="btn-primary" disabled={pending}>Guardar</button>
        </form>
      </section>

      <section className="card p-5">
        <h2 className="font-semibold">Cambiar contraseña</h2>
        <p className="mt-0.5 text-sm text-slate-500">Se cerrará la sesión en el resto de dispositivos.</p>
        <form
          className="mt-4 space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (next !== repeat) return toast("Las contraseñas nuevas no coinciden.", "error");
            start(async () => {
              const res = await changePassword(current, next);
              toast(res.ok ? "Contraseña actualizada" : res.error, res.ok ? "success" : "error");
              if (res.ok) {
                setCurrent("");
                setNext("");
                setRepeat("");
              }
            });
          }}
        >
          <input type="text" name="username" autoComplete="username" value={props.email} readOnly hidden />
          <div>
            <label className="label" htmlFor="pw-current">Contraseña actual</label>
            <input id="pw-current" type="password" className="input" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} required />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="label" htmlFor="pw-new">Nueva contraseña (mín. 10)</label>
              <input id="pw-new" type="password" className="input" autoComplete="new-password" minLength={10} value={next} onChange={(e) => setNext(e.target.value)} required />
            </div>
            <div>
              <label className="label" htmlFor="pw-repeat">Repite la nueva</label>
              <input id="pw-repeat" type="password" className="input" autoComplete="new-password" minLength={10} value={repeat} onChange={(e) => setRepeat(e.target.value)} required />
            </div>
          </div>
          <button className="btn-primary" disabled={pending}>Cambiar contraseña</button>
        </form>
      </section>
    </div>
  );
}

function GoogleSection({ google }: { google: Props["google"] }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  return (
    <section id="google" className="card scroll-mt-4 p-5">
      <h2 className="flex items-center gap-2 font-semibold"><Link2 size={17} /> Google Docs y Sheets</h2>
      <p className="mt-0.5 text-sm text-slate-500">
        Conecta tu cuenta para crear documentos y hojas de cálculo desde las tarjetas con <code>@docs</code> y <code>@sheets</code>.
        Tablón solo puede acceder a los archivos que crea él mismo (permiso <code>drive.file</code>).
      </p>
      {google.message && (
        <p className={cn("mt-3 rounded-lg px-3 py-2 text-sm", google.message.ok ? "bg-emerald-50 text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-300" : "bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-300")}>
          {google.message.text}
        </p>
      )}
      <div className="mt-4">
        {!google.enabled ? (
          <p className="text-sm text-slate-500">Un administrador debe configurar <code>GOOGLE_CLIENT_ID</code> y <code>GOOGLE_CLIENT_SECRET</code> en el servidor.</p>
        ) : google.email ? (
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-sm">Conectada como <strong>{google.email}</strong></span>
            <button
              className="btn-secondary"
              disabled={pending}
              onClick={() =>
                start(async () => {
                  const res = await disconnectGoogle();
                  toast(res.ok ? "Cuenta de Google desconectada" : res.error, res.ok ? "success" : "error");
                  if (res.ok) router.replace("/settings#google");
                  router.refresh();
                })
              }
            >
              Desconectar
            </button>
          </div>
        ) : (
          <a href="/api/google/connect" className="btn-primary">Conectar con Google</a>
        )}
      </div>
    </section>
  );
}

function NotificationSection({ prefs }: { prefs: Props["notifications"] }) {
  const toast = useToast();
  const [pending, start] = useTransition();
  const [notifyEmail, setNotifyEmail] = useState(prefs.notifyEmail);
  const [notifyWhatsapp, setNotifyWhatsapp] = useState(prefs.notifyWhatsapp);
  const [phone, setPhone] = useState(prefs.whatsappPhone);
  return (
    <section className="card p-5">
      <h2 className="flex items-center gap-2 font-semibold"><Bell size={17} /> Avisos de menciones</h2>
      <p className="mt-0.5 text-sm text-slate-500">Cuando alguien te menciona con @ en una tarjeta o comentario, siempre te aparece en la campana de avisos. Además puedes recibirlo por:</p>
      <form
        className="mt-4 space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          start(async () => {
            const res = await updateNotificationPrefs({ notifyEmail, notifyWhatsapp, whatsappPhone: phone });
            toast(res.ok ? "Preferencias guardadas" : res.error, res.ok ? "success" : "error");
          });
        }}
      >
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" className="mt-0.5" checked={notifyEmail} onChange={(e) => setNotifyEmail(e.target.checked)} />
          <span>
            Email
            {!prefs.emailAvailable && <span className="block text-xs text-slate-500">El envío de emails aún no está configurado en el servidor.</span>}
          </span>
        </label>
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" className="mt-0.5" checked={notifyWhatsapp} onChange={(e) => setNotifyWhatsapp(e.target.checked)} />
          <span>
            WhatsApp
            <span className="block text-xs text-slate-500">
              {prefs.whatsappAvailable
                ? "Al activarlo aceptas recibir estos avisos en tu número de WhatsApp."
                : "El envío por WhatsApp aún no está configurado en el servidor; tu preferencia se guardará para cuando lo esté."}
            </span>
          </span>
        </label>
        {notifyWhatsapp && (
          <div className="max-w-xs">
            <label className="label" htmlFor="wa-phone">Número de WhatsApp (formato internacional)</label>
            <input id="wa-phone" type="tel" inputMode="tel" className="input" placeholder="+34600111222" value={phone} onChange={(e) => setPhone(e.target.value)} autoComplete="tel" />
          </div>
        )}
        <button className="btn-primary" disabled={pending}>Guardar avisos</button>
      </form>
    </section>
  );
}
