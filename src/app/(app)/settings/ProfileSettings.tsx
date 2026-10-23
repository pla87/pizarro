"use client";

import { PasswordInput } from "@/components/ui/PasswordInput";
import { ArrowDown, ArrowUp, Bell, Check, Eye, Link2, Monitor, Moon, Palette, Pencil, PenLine, Plus, Sun, Trash2, X, Languages } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import {
  changePassword, createReleaseTemplate, deleteReleaseTemplate, disconnectGoogle, moveReleaseTemplate, updateCardStyle, updateNotificationPrefs,
  updateAccent, updateEditorMode, updateProfileName, updateReleaseTemplate, updateTheme, updateLocale,
} from "@/actions/profile";
import { cn } from "@/components/ui/cn";
import { Markdown } from "@/components/ui/Markdown";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { useToast } from "@/components/ui/Toast";
import { useT } from "@/i18n/client";
import { DraftsSection } from "./DraftsSection";
import type { CardStyleValue, EditorModeValue, TemplateOption } from "@/lib/types";

type ThemeValue = "SYSTEM" | "LIGHT" | "DARK";
type AccentValue = "BLUE" | "FOREST" | "SIENNA" | "MUSTARD" | "MONO" | "EVA";

// Muestra de cada tema: su color principal (brand-600) sobre su fondo (slate-200) de globals.css.
const ACCENTS: { value: AccentValue; label: string; swatch: string }[] = [
  { value: "BLUE", label: "Azul", swatch: "linear-gradient(135deg, #4f46e5 50%, #e2e8f0 50%)" },
  { value: "FOREST", label: "Verde bosque", swatch: "linear-gradient(135deg, #1f6b42 50%, #d2dccf 50%)" },
  { value: "SIENNA", label: "Siena", swatch: "linear-gradient(135deg, #a2491f 50%, #e6d7cb 50%)" },
  { value: "MUSTARD", label: "Mostaza", swatch: "linear-gradient(135deg, #9a7209 50%, #e5dec3 50%)" },
  { value: "MONO", label: "Blanco y negro", swatch: "linear-gradient(135deg, #111111 50%, #ffffff 50%)" },
  { value: "EVA", label: "Eva", swatch: "linear-gradient(135deg, #6b3fa0 50%, #a6e22e 50%)" },
];

interface Props {
  name: string;
  email: string;
  templates: { headers: TemplateOption[]; footers: TemplateOption[] };
  cardStyle: CardStyleValue;
  editorMode: EditorModeValue;
  clearDraftsOnLogout: boolean;
  theme: ThemeValue;
  accent: AccentValue;
  locale: "ES" | "EN";
  notifications: {
    notifyEmail: boolean;
    notifyWhatsapp: boolean;
    whatsappPhone: string;
    emailAvailable: boolean;
    whatsappAvailable: boolean;
  };
  google: { enabled: boolean; email: string | null; message: { ok: boolean; text: string } | null };
  /** Bloque extra bajo «Avisos» (avisos por email de más tipos y resumen diario). */
  notificationExtras?: React.ReactNode;
}

export function ProfileSettings(props: Props) {
  const t = useT();
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const [name, setName] = useState(props.name);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [repeat, setRepeat] = useState("");

  return (
    <div className="mx-auto max-w-3xl space-y-5 p-4 md:p-6">
      <h1 className="text-xl font-semibold">{t("Mi perfil")}</h1>

      <section className="card p-5">
        <h2 className="font-semibold">{t("Plantillas de release notes")}</h2>
        <p className="mt-0.5 text-sm text-slate-500">
          {t("Puedes tener varias cabeceras y varios pies. Al generar una release eliges cuáles usar y se insertan en el texto. Admiten Markdown.")}
        </p>
        <TemplateList kind="HEADER" title={t("Cabeceras")} initial={props.templates.headers} placeholder={t("Ej.: instrucciones de contexto para una IA.\n\n> Resume estos cambios para el equipo de negocio.")} />
        <TemplateList kind="FOOTER" title={t("Pies")} initial={props.templates.footers} placeholder={t("Ej.: checklist de validación.\n\n- [ ] Migraciones aplicadas\n- [ ] Prueba en producción")} />
      </section>

      <LanguageSection initial={props.locale} />
      <AppearanceSection initial={props.cardStyle} initialTheme={props.theme} initialAccent={props.accent} />
      <EditorModeSection initial={props.editorMode} />
      <DraftsSection initial={props.clearDraftsOnLogout} />
      <GoogleSection google={props.google} />
      <NotificationSection prefs={props.notifications} />
      {props.notificationExtras}

      <section className="card p-5">
        <h2 className="font-semibold">{t("Perfil")}</h2>
        <form
          className="mt-4 space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            start(async () => {
              const res = await updateProfileName(name);
              toast(res.ok ? t("Perfil actualizado") : res.error, res.ok ? "success" : "error");
              if (res.ok) router.refresh();
            });
          }}
        >
          <div>
            <div className="label">Email</div>
            <p className="text-sm">{props.email}</p>
          </div>
          <div>
            <label className="label" htmlFor="pf-name">{t("Nombre visible")}</label>
            <input id="pf-name" className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} required />
          </div>
          <button className="btn-primary" disabled={pending}>{t("Guardar")}</button>
        </form>
      </section>

      <section className="card p-5">
        <h2 className="font-semibold">{t("Cambiar contraseña")}</h2>
        <p className="mt-0.5 text-sm text-slate-500">
          {props.notifications.emailAvailable
            ? t("Te enviaremos un enlace por email para confirmar el cambio; al confirmarlo se cerrará la sesión en todos los dispositivos.")
            : t("Se cerrará la sesión en el resto de dispositivos.")}
        </p>
        <form
          className="mt-4 space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (next !== repeat) return toast(t("Las contraseñas nuevas no coinciden."), "error");
            start(async () => {
              const res = await changePassword(current, next);
              toast(res.ok ? (res.data.pending ? t("Te hemos enviado un email: confirma el cambio con el enlace (caduca en 30 minutos).") : t("Contraseña actualizada")) : res.error, res.ok ? "success" : "error");
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
            <label className="label" htmlFor="pw-current">{t("Contraseña actual")}</label>
            <PasswordInput id="pw-current" className="input" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} required />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="label" htmlFor="pw-new">{t("Nueva contraseña (mín. 10)")}</label>
              <PasswordInput id="pw-new" className="input" autoComplete="new-password" minLength={10} value={next} onChange={(e) => setNext(e.target.value)} required />
            </div>
            <div>
              <label className="label" htmlFor="pw-repeat">{t("Repite la nueva")}</label>
              <PasswordInput id="pw-repeat" className="input" autoComplete="new-password" minLength={10} value={repeat} onChange={(e) => setRepeat(e.target.value)} required />
            </div>
          </div>
          <button className="btn-primary" disabled={pending}>{t("Cambiar contraseña")}</button>
        </form>
      </section>
    </div>
  );
}

/** Idioma: los nombres de cada opción van en su propio idioma. */
function LanguageSection({ initial }: { initial: "ES" | "EN" }) {
  const router = useRouter();
  const toast = useToast();
  const [locale, setLocale] = useState(initial);
  const choose = async (value: "ES" | "EN") => {
    if (value === locale) return;
    const previous = locale;
    setLocale(value);
    const res = await updateLocale(value);
    if (!res.ok) {
      setLocale(previous);
      return toast(res.error, "error");
    }
    router.refresh();
  };
  return (
    <section className="card p-5">
      <h2 className="flex items-center gap-2 font-semibold"><Languages size={17} /> Idioma · Language</h2>
      <div className="mt-3 flex flex-wrap gap-2" role="radiogroup" aria-label="Idioma · Language">
        {([["ES", "Español"], ["EN", "English"]] as const).map(([value, label]) => (
          <button
            key={value}
            role="radio"
            aria-checked={locale === value}
            onClick={() => choose(value)}
            className={cn("rounded-lg border-2 px-4 py-2 text-sm font-medium", locale === value ? "border-brand-500" : "border-slate-200 dark:border-slate-700")}
          >
            {label}
          </button>
        ))}
      </div>
    </section>
  );
}

function EditorModeSection({ initial }: { initial: EditorModeValue }) {
  const t = useT();
  const router = useRouter();
  const toast = useToast();
  const [mode, setMode] = useState(initial);
  const choose = async (value: EditorModeValue) => {
    const previous = mode;
    setMode(value);
    const res = await updateEditorMode(value);
    if (!res.ok) {
      setMode(previous);
      return toast(res.error, "error");
    }
    router.refresh();
  };
  return (
    <section className="card p-5">
      <h2 className="flex items-center gap-2 font-semibold"><PenLine size={17} /> {t("Edición de descripciones")}</h2>
      <p className="mt-0.5 text-sm text-slate-500">{t("Las descripciones se guardan siempre como Markdown; esto solo cambia cómo las escribes.")}</p>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        {([
          ["MARKDOWN", "Markdown", "Escribes los símbolos (**negrita**, - lista, # título). Al guardar se ve formateado."],
          ["WYSIWYG", "Con barra de formato", "Ves el resultado mientras escribes y aplicas negrita, listas o títulos con botones."],
        ] as const).map(([value, label, hint]) => (
          <button
            key={value}
            onClick={() => choose(value)}
            className={cn("rounded-xl border-2 p-3 text-left", mode === value ? "border-brand-500" : "border-slate-200 dark:border-slate-700")}
            aria-pressed={mode === value}
          >
            <div className="text-sm font-medium">{t(label)}</div>
            <div className="mt-1 text-xs text-slate-500">{t(hint)}</div>
          </button>
        ))}
      </div>
    </section>
  );
}

function GoogleSection({ google }: { google: Props["google"] }) {
  const t = useT();
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  return (
    <section id="google" className="card scroll-mt-4 p-5">
      <h2 className="flex items-center gap-2 font-semibold"><Link2 size={17} /> {t("Google Docs y Sheets")}</h2>
      <p className="mt-0.5 text-sm text-slate-500">
        {t("Conecta tu cuenta para crear documentos y hojas de cálculo desde las tarjetas con")} <code>@docs</code> {t("y")} <code>@sheets</code>.
        {t("Pizarro solo puede acceder a los archivos que crea él mismo (permiso")} <code>drive.file</code>).
      </p>
      {google.message && (
        <p className={cn("mt-3 rounded-lg px-3 py-2 text-sm", google.message.ok ? "bg-emerald-50 text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-300" : "bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-300")}>
          {google.message.text}
        </p>
      )}
      <div className="mt-4">
        {!google.enabled ? (
          <p className="text-sm text-slate-500">{t("Un administrador debe configurar")} <code>GOOGLE_CLIENT_ID</code> {t("y")} <code>GOOGLE_CLIENT_SECRET</code> {t("en el servidor.")}</p>
        ) : google.email ? (
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-sm">{t("Conectada como")} <strong>{google.email}</strong></span>
            <button
              className="btn-secondary"
              disabled={pending}
              onClick={() =>
                start(async () => {
                  const res = await disconnectGoogle();
                  toast(res.ok ? t("Cuenta de Google desconectada") : res.error, res.ok ? "success" : "error");
                  if (res.ok) router.replace("/settings#google");
                  router.refresh();
                })
              }
            >
              {t("Desconectar")}
            </button>
          </div>
        ) : (
          <a href="/api/google/connect" className="btn-primary">{t("Conectar con Google")}</a>
        )}
      </div>
    </section>
  );
}

function NotificationSection({ prefs }: { prefs: Props["notifications"] }) {
  const t = useT();
  const toast = useToast();
  const [pending, start] = useTransition();
  const [notifyEmail, setNotifyEmail] = useState(prefs.notifyEmail);
  const [notifyWhatsapp, setNotifyWhatsapp] = useState(prefs.notifyWhatsapp);
  const [phone, setPhone] = useState(prefs.whatsappPhone);
  return (
    <section className="card p-5">
      <h2 className="flex items-center gap-2 font-semibold"><Bell size={17} /> {t("Avisos de menciones")}</h2>
      <p className="mt-0.5 text-sm text-slate-500">{t("Cuando alguien te menciona con @ en una tarjeta o comentario, siempre te aparece en la campana de avisos. Además puedes recibirlo por:")}</p>
      <form
        className="mt-4 space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          start(async () => {
            const res = await updateNotificationPrefs({ notifyEmail, notifyWhatsapp, whatsappPhone: phone });
            toast(res.ok ? t("Preferencias guardadas") : res.error, res.ok ? "success" : "error");
          });
        }}
      >
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" className="mt-0.5" checked={notifyEmail} onChange={(e) => setNotifyEmail(e.target.checked)} />
          <span>
            Email
            {!prefs.emailAvailable && <span className="block text-xs text-slate-500">{t("El envío de emails aún no está configurado en el servidor.")}</span>}
          </span>
        </label>
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" className="mt-0.5" checked={notifyWhatsapp} onChange={(e) => setNotifyWhatsapp(e.target.checked)} />
          <span>
            WhatsApp
            <span className="block text-xs text-slate-500">
              {prefs.whatsappAvailable
                ? t("Al activarlo aceptas recibir estos avisos en tu número de WhatsApp.")
                : t("El envío por WhatsApp aún no está configurado en el servidor; tu preferencia se guardará para cuando lo esté.")}
            </span>
          </span>
        </label>
        {notifyWhatsapp && (
          <div className="max-w-xs">
            <label className="label" htmlFor="wa-phone">{t("Número de WhatsApp (formato internacional)")}</label>
            <input id="wa-phone" type="tel" inputMode="tel" className="input" placeholder="+34600111222" value={phone} onChange={(e) => setPhone(e.target.value)} autoComplete="tel" />
          </div>
        )}
        <button className="btn-primary" disabled={pending}>{t("Guardar avisos")}</button>
      </form>
    </section>
  );
}

function TemplateList({ kind, title, initial, placeholder }: { kind: "HEADER" | "FOOTER"; title: string; initial: TemplateOption[]; placeholder: string }) {
  const t = useT();
  const toast = useToast();
  const confirm = useConfirm();
  const [items, setItems] = useState(initial);
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const [form, setForm] = useState({ name: "", content: "" });
  const [preview, setPreview] = useState(false);
  const [pending, start] = useTransition();

  // Sube/baja una plantilla; la primera es la que «Generar release» elige por defecto.
  const move = (id: string, dir: -1 | 1) =>
    start(async () => {
      const index = items.findIndex((x) => x.id === id);
      const target = index + dir;
      if (index < 0 || target < 0 || target >= items.length) return;
      const previous = items;
      const next = items.slice();
      [next[index], next[target]] = [next[target]!, next[index]!];
      setItems(next);
      const res = await moveReleaseTemplate(id, dir);
      if (!res.ok) {
        setItems(previous);
        toast(res.error, "error");
      }
    });

  const open = (tpl?: TemplateOption) => {
    setEditing(tpl ? tpl.id : "new");
    setForm(tpl ? { name: tpl.name, content: tpl.content } : { name: "", content: "" });
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
        setItems((l) => l.map((x) => (x.id === editing ? { ...x, name: form.name.trim(), content: form.content } : x)));
      }
      setEditing(null);
      toast(t("Plantilla guardada"));
    });

  return (
    <div className="mt-5">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-sm font-semibold">{title}</h3>
        {editing === null && (
          <button className="btn-ghost py-1 text-xs" onClick={() => open()}>
            <Plus size={14} /> {t("Añadir")}
          </button>
        )}
      </div>
      <ul className="divide-y divide-slate-200 rounded-lg border border-slate-200 dark:divide-slate-800 dark:border-slate-800">
        {items.map((tpl, i) => (
          <li key={tpl.id} className="flex items-start gap-2 px-3 py-2">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 text-sm font-medium">
                {tpl.name}
                {i === 0 && items.length > 1 && <span className="badge bg-brand-50 text-brand-700 ring-brand-200 dark:bg-brand-500/15 dark:text-brand-200 dark:ring-brand-500/40">{t("Por defecto")}</span>}
              </div>
              <p className="line-clamp-2 font-mono text-xs whitespace-pre-wrap text-slate-500">{tpl.content || t("(vacía)")}</p>
            </div>
            {items.length > 1 && (
              <>
                <button className="btn-icon h-7 w-7" disabled={i === 0 || pending} onClick={() => move(tpl.id, -1)} aria-label={t("Subir {name}", { name: tpl.name })}><ArrowUp size={14} /></button>
                <button className="btn-icon h-7 w-7" disabled={i === items.length - 1 || pending} onClick={() => move(tpl.id, 1)} aria-label={t("Bajar {name}", { name: tpl.name })}><ArrowDown size={14} /></button>
              </>
            )}
            <button className="btn-icon h-7 w-7" onClick={() => open(tpl)} aria-label={t("Editar {name}", { name: tpl.name })}><Pencil size={14} /></button>
            <button
              className="btn-icon h-7 w-7 hover:text-red-600"
              aria-label={t("Borrar {name}", { name: tpl.name })}
              onClick={async () => {
                if (!(await confirm({ title: t("Borrar plantilla"), message: t("¿Borrar «{name}»?", { name: tpl.name }), confirmLabel: t("Borrar"), danger: true }))) return;
                const res = await deleteReleaseTemplate(tpl.id);
                if (!res.ok) return toast(res.error, "error");
                setItems((l) => l.filter((x) => x.id !== tpl.id));
              }}
            >
              <Trash2 size={14} />
            </button>
          </li>
        ))}
        {items.length === 0 && <li className="px-3 py-2 text-sm text-slate-500">{t("Ninguna todavía.")}</li>}
      </ul>
      {editing !== null && (
        <div className="mt-3 space-y-2 rounded-lg border border-brand-500/40 p-3">
          <input className="input" placeholder={t("Nombre (p. ej. «Para el equipo de negocio»)")} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} maxLength={60} autoFocus />
          <div className="flex items-center gap-1 rounded-lg bg-slate-100 p-1 text-xs dark:bg-slate-800">
            {[false, true].map((p) => (
              <button
                key={String(p)}
                onClick={() => setPreview(p)}
                className={cn("flex flex-1 items-center justify-center gap-1 rounded-md px-2 py-1 font-medium", preview === p ? "bg-white shadow-sm dark:bg-slate-900" : "text-slate-500")}
              >
                {p ? <><Eye size={13} /> {t("Vista previa")}</> : <><Pencil size={13} /> {t("Editar")}</>}
              </button>
            ))}
          </div>
          {preview ? (
            <div className="min-h-24 rounded-lg border border-slate-200 p-3 dark:border-slate-800"><Markdown>{form.content}</Markdown></div>
          ) : (
            <textarea className="input field-sizing-content min-h-28 font-mono text-[13px]" value={form.content} onChange={(e) => setForm({ ...form, content: e.target.value })} maxLength={20000} placeholder={placeholder} />
          )}
          <div className="flex gap-2">
            <button className="btn-primary py-1.5" onClick={save} disabled={pending || !form.name.trim()}><Check size={15} /> {t("Guardar")}</button>
            <button className="btn-ghost py-1.5" onClick={() => setEditing(null)}><X size={15} /> {t("Cancelar")}</button>
          </div>
        </div>
      )}
    </div>
  );
}

/** Aplica el tema al instante en <html>; el servidor lo vuelve a pintar tras revalidar. */
function applyTheme(value: ThemeValue) {
  const root = document.documentElement;
  if (value === "SYSTEM") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", value.toLowerCase());
}

/** Aplica el acento al instante en <html> (BLUE = sin atributo). */
function applyAccent(value: AccentValue) {
  const root = document.documentElement;
  if (value === "BLUE") root.removeAttribute("data-accent");
  else root.setAttribute("data-accent", value.toLowerCase());
}

function AppearanceSection({ initial, initialTheme, initialAccent }: { initial: CardStyleValue; initialTheme: ThemeValue; initialAccent: AccentValue }) {
  const t = useT();
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
  const [theme, setTheme] = useState(initialTheme);
  const chooseTheme = async (value: ThemeValue) => {
    const previous = theme;
    setTheme(value);
    applyTheme(value);
    const res = await updateTheme(value);
    if (!res.ok) {
      setTheme(previous);
      applyTheme(previous);
      return toast(res.error, "error");
    }
    router.refresh();
  };
  const [accent, setAccent] = useState(initialAccent);
  const chooseAccent = async (value: AccentValue) => {
    const previous = accent;
    setAccent(value);
    applyAccent(value);
    const res = await updateAccent(value);
    if (!res.ok) {
      setAccent(previous);
      applyAccent(previous);
      return toast(res.error, "error");
    }
    router.refresh();
  };
  const sample = "#6366f1";
  return (
    <section className="card p-5">
      <h2 className="flex items-center gap-2 font-semibold"><Palette size={17} /> {t("Apariencia")}</h2>
      <h3 className="mt-4 text-sm font-semibold">{t("Tema")}</h3>
      <p className="mt-0.5 text-sm text-slate-500">{t("«Sistema» sigue el modo claro u oscuro de tu dispositivo.")}</p>
      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        {([
          ["SYSTEM", "Sistema", Monitor],
          ["LIGHT", "Claro", Sun],
          ["DARK", "Oscuro", Moon],
        ] as const).map(([value, label, Icon]) => (
          <button
            key={value}
            onClick={() => chooseTheme(value)}
            className={cn("flex items-center gap-2 rounded-xl border-2 p-3 text-left text-sm", theme === value ? "border-brand-500" : "border-slate-200 dark:border-slate-700")}
            aria-pressed={theme === value}
          >
            <Icon size={16} /> {t(label)}
          </button>
        ))}
      </div>
      <h3 className="mt-6 text-sm font-semibold">{t("Tema de color")}</h3>
      <p className="mt-0.5 text-sm text-slate-500">{t("Colores de toda la app: fondos, bordes, botones, enlaces y selecciones, en modo claro y oscuro.")}</p>
      <div role="radiogroup" aria-label={t("Tema de color")} className="mt-3 flex flex-wrap gap-4">
        {ACCENTS.map(({ value, label, swatch }) => (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={accent === value}
            onClick={() => chooseAccent(value)}
            className="group flex w-20 flex-col items-center gap-1.5 text-center text-xs focus-visible:outline-none"
          >
            <span
              className={cn(
                "flex h-9 w-9 items-center justify-center rounded-full group-focus-visible:outline-2 group-focus-visible:outline-offset-4 ring-offset-2 ring-offset-white dark:ring-offset-slate-900",
                value === "MONO" && "border border-slate-300 dark:border-slate-600",
                accent === value ? "ring-2 ring-slate-900 dark:ring-slate-100" : "ring-1 ring-transparent hover:ring-slate-300 dark:hover:ring-slate-600",
              )}
              style={{ background: swatch }}
            >
              {accent === value && <Check size={16} className="text-white drop-shadow-[0_0_2px_rgb(0_0_0/0.9)]" />}
            </span>
            <span className={accent === value ? "font-semibold" : "text-slate-600 dark:text-slate-400"}>{t(label)}</span>
          </button>
        ))}
      </div>
      <h3 className="mt-6 text-sm font-semibold">{t("Tarjetas")}</h3>
      <p className="mt-0.5 text-sm text-slate-500">{t("Cómo se muestra el color de cada tarjeta en el tablero.")}</p>
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
              {t("Tarjeta de ejemplo")}
            </div>
            <div className="mt-2 text-sm">{t(label)}</div>
          </button>
        ))}
      </div>
    </section>
  );
}
