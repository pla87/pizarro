"use client";

import { PasswordInput } from "@/components/ui/PasswordInput";
import { Bell, Check, Eye, Link2, Palette, Pencil, Plus, Trash2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import {
  changePassword, createReleaseTemplate, deleteReleaseTemplate, disconnectGoogle, updateCardStyle, updateNotificationPrefs,
  updateProfileName, updateReleaseTemplate,
} from "@/actions/profile";
import { cn } from "@/components/ui/cn";
import { Markdown } from "@/components/ui/Markdown";
import { useToast } from "@/components/ui/Toast";
import type { CardStyleValue, TemplateOption } from "@/lib/types";

interface Props {
  name: string;
  email: string;
  templates: { headers: TemplateOption[]; footers: TemplateOption[] };
  cardStyle: CardStyleValue;
  notifications: {
    notifyEmail: boolean;
    notifyWhatsapp: boolean;
    whatsappPhone: string;
    emailAvailable: boolean;
    whatsappAvailable: boolean;
  };
  google: { enabled: boolean; email: string | null; message: { ok: boolean; text: string } | null };
}

export function ProfileSettings(props: Props) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const [name, setName] = useState(props.name);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [repeat, setRepeat] = useState("");

  return (
    <div className="mx-auto max-w-3xl space-y-5 p-4 md:p-6">
      <h1 className="text-xl font-semibold">Mi perfil y plantillas</h1>

      <section className="card p-5">
        <h2 className="font-semibold">Plantillas de release notes</h2>
        <p className="mt-0.5 text-sm text-slate-500">
          Puedes tener varias cabeceras y varios pies. Al generar una release eliges cuáles usar y se insertan en el texto. Admiten Markdown.
        </p>
        <TemplateList kind="HEADER" title="Cabeceras" initial={props.templates.headers} placeholder={"Ej.: instrucciones de contexto para una IA.\n\n> Resume estos cambios para el equipo de negocio."} />
        <TemplateList kind="FOOTER" title="Pies" initial={props.templates.footers} placeholder={"Ej.: checklist de validación.\n\n- [ ] Migraciones aplicadas\n- [ ] Prueba en producción"} />
      </section>

      <AppearanceSection initial={props.cardStyle} />
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
            <PasswordInput id="pw-current" className="input" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} required />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="label" htmlFor="pw-new">Nueva contraseña (mín. 10)</label>
              <PasswordInput id="pw-new" className="input" autoComplete="new-password" minLength={10} value={next} onChange={(e) => setNext(e.target.value)} required />
            </div>
            <div>
              <label className="label" htmlFor="pw-repeat">Repite la nueva</label>
              <PasswordInput id="pw-repeat" className="input" autoComplete="new-password" minLength={10} value={repeat} onChange={(e) => setRepeat(e.target.value)} required />
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

function TemplateList({ kind, title, initial, placeholder }: { kind: "HEADER" | "FOOTER"; title: string; initial: TemplateOption[]; placeholder: string }) {
  const toast = useToast();
  const [items, setItems] = useState(initial);
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const [form, setForm] = useState({ name: "", content: "" });
  const [preview, setPreview] = useState(false);
  const [pending, start] = useTransition();

  const open = (t?: TemplateOption) => {
    setEditing(t ? t.id : "new");
    setForm(t ? { name: t.name, content: t.content } : { name: "", content: "" });
    setPreview(false);
  };

  const save = () =>
    start(async () => {
      if (editing === "new") {
        const res = await createReleaseTemplate(kind, form);
        if (!res.ok) return toast(res.error, "error");
        setItems((l) => [...l, res.data]);
      } else if (editing) {
        const res = await updateReleaseTemplate(editing, form);
        if (!res.ok) return toast(res.error, "error");
        setItems((l) => l.map((t) => (t.id === editing ? { ...t, name: form.name.trim(), content: form.content } : t)));
      }
      setEditing(null);
      toast("Plantilla guardada");
    });

  return (
    <div className="mt-5">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-sm font-semibold">{title}</h3>
        {editing === null && (
          <button className="btn-ghost py-1 text-xs" onClick={() => open()}>
            <Plus size={14} /> Añadir
          </button>
        )}
      </div>
      <ul className="divide-y divide-slate-200 rounded-lg border border-slate-200 dark:divide-slate-800 dark:border-slate-800">
        {items.map((t) => (
          <li key={t.id} className="flex items-start gap-2 px-3 py-2">
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium">{t.name}</div>
              <p className="line-clamp-2 font-mono text-xs whitespace-pre-wrap text-slate-500">{t.content || "(vacía)"}</p>
            </div>
            <button className="btn-icon h-7 w-7" onClick={() => open(t)} aria-label={`Editar ${t.name}`}><Pencil size={14} /></button>
            <button
              className="btn-icon h-7 w-7 hover:text-red-600"
              aria-label={`Borrar ${t.name}`}
              onClick={async () => {
                if (!window.confirm(`¿Borrar «${t.name}»?`)) return;
                const res = await deleteReleaseTemplate(t.id);
                if (!res.ok) return toast(res.error, "error");
                setItems((l) => l.filter((x) => x.id !== t.id));
              }}
            >
              <Trash2 size={14} />
            </button>
          </li>
        ))}
        {items.length === 0 && <li className="px-3 py-2 text-sm text-slate-500">Ninguna todavía.</li>}
      </ul>
      {editing !== null && (
        <div className="mt-3 space-y-2 rounded-lg border border-brand-500/40 p-3">
          <input className="input" placeholder="Nombre (p. ej. «Para el equipo de negocio»)" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} maxLength={60} autoFocus />
          <div className="flex items-center gap-1 rounded-lg bg-slate-100 p-1 text-xs dark:bg-slate-800">
            {[false, true].map((p) => (
              <button
                key={String(p)}
                onClick={() => setPreview(p)}
                className={cn("flex flex-1 items-center justify-center gap-1 rounded-md px-2 py-1 font-medium", preview === p ? "bg-white shadow-sm dark:bg-slate-900" : "text-slate-500")}
              >
                {p ? <><Eye size={13} /> Vista previa</> : <><Pencil size={13} /> Editar</>}
              </button>
            ))}
          </div>
          {preview ? (
            <div className="min-h-24 rounded-lg border border-slate-200 p-3 dark:border-slate-800"><Markdown>{form.content}</Markdown></div>
          ) : (
            <textarea className="input field-sizing-content min-h-28 font-mono text-[13px]" value={form.content} onChange={(e) => setForm({ ...form, content: e.target.value })} maxLength={20000} placeholder={placeholder} />
          )}
          <div className="flex gap-2">
            <button className="btn-primary py-1.5" onClick={save} disabled={pending || !form.name.trim()}><Check size={15} /> Guardar</button>
            <button className="btn-ghost py-1.5" onClick={() => setEditing(null)}><X size={15} /> Cancelar</button>
          </div>
        </div>
      )}
    </div>
  );
}

function AppearanceSection({ initial }: { initial: CardStyleValue }) {
  const router = useRouter();
  const toast = useToast();
  const [style, setStyle] = useState(initial);
  const choose = async (value: CardStyleValue) => {
    setStyle(value);
    const res = await updateCardStyle(value);
    if (!res.ok) {
      setStyle(initial);
      return toast(res.error, "error");
    }
    router.refresh();
  };
  const sample = "#6366f1";
  return (
    <section className="card p-5">
      <h2 className="flex items-center gap-2 font-semibold"><Palette size={17} /> Apariencia de las tarjetas</h2>
      <p className="mt-0.5 text-sm text-slate-500">Cómo se muestra el color de cada tarjeta en el tablero.</p>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        {([
          ["STRIPE", "Franja a la izquierda"],
          ["FILLED", "Tarjeta entera del color"],
        ] as const).map(([value, label]) => (
          <button
            key={value}
            onClick={() => choose(value)}
            className={cn("rounded-xl border-2 p-3 text-left", style === value ? "border-brand-500" : "border-slate-200 dark:border-slate-700")}
            aria-pressed={style === value}
          >
            <div
              className="relative overflow-hidden rounded-lg border border-slate-200 bg-white p-2.5 pl-3 text-sm font-medium dark:border-slate-700 dark:bg-slate-900"
              style={value === "FILLED" ? { backgroundColor: `${sample}26`, borderColor: `${sample}66` } : undefined}
            >
              {value === "STRIPE" && <span className="absolute inset-y-0 left-0 w-1" style={{ backgroundColor: sample }} />}
              Tarjeta de ejemplo
            </div>
            <div className="mt-2 text-sm">{label}</div>
          </button>
        ))}
      </div>
    </section>
  );
}
