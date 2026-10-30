"use client";

import { ExternalLink, Loader2 } from "lucide-react";
import { useState, useTransition } from "react";
import { saveLegalIdentity, saveLegalPage } from "@/actions/legal";
import { Markdown } from "@/components/ui/Markdown";
import { DescriptionField } from "@/components/ui/DescriptionField";
import { useToast } from "@/components/ui/Toast";
import { cn } from "@/components/ui/cn";
import { useT } from "@/i18n/client";
import type { LegalSettings } from "@/lib/legal";
import { defaultLegalMarkdown, fillLegalPlaceholders, LEGAL_MAX, LEGAL_RESPONSIBLE_MAX, pickLegalText, type LegalKind } from "@/lib/legal-core";
import { actionThrowResult } from "@/lib/stale-action";
import type { EditorModeValue } from "@/lib/types";

const NO_USERS: never[] = [];
type Lang = "es" | "en";

/** «Textos legales»: responsable, contacto y texto propio (español e inglés) de /privacy y /terms. */
export function LegalAdmin({ settings, editorMode }: { settings: LegalSettings; editorMode: EditorModeValue }) {
  const t = useT();
  const toast = useToast();
  const [pending, start] = useTransition();
  const [savedId, setSavedId] = useState({ responsible: settings.responsible, email: settings.email });
  const [responsible, setResponsible] = useState(settings.responsible);
  const [email, setEmail] = useState(settings.email);
  const idDirty = responsible.trim() !== savedId.responsible || email.trim() !== savedId.email;

  const saveId = () =>
    start(async () => {
      const res = await saveLegalIdentity({ responsible, email }).catch((e) => actionThrowResult(e, t));
      if (!res.ok) return toast(res.error, "error");
      setSavedId(res.data);
      setResponsible(res.data.responsible);
      setEmail(res.data.email);
      toast(t("Guardado."), "success");
    });

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-500">
        {t("Los textos de las páginas públicas /privacy y /terms (las que pide Google y enlaza la pantalla de acceso). Si no escribes nada se usa el texto genérico.")}
      </p>

      <section className="card space-y-3 p-5">
        <h2 className="text-sm font-semibold">{t("Responsable y contacto")}</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-sm">
            <span className="font-medium">{t("Nombre del responsable")}</span>
            <input className="input mt-1 w-full" value={responsible} onChange={(e) => setResponsible(e.target.value)} maxLength={LEGAL_RESPONSIBLE_MAX} placeholder="Empresa Ejemplo, S.L." autoComplete="off" />
            <span className="mt-1 block text-xs text-slate-500">{t("Empresa o persona que opera esta instalación. Sustituye a {responsable} en los textos.")}</span>
          </label>
          <label className="block text-sm">
            <span className="font-medium">{t("Email de contacto público (opcional)")}</span>
            <input className="input mt-1 w-full" type="email" value={email} onChange={(e) => setEmail(e.target.value)} maxLength={200} placeholder="privacidad@example.com" autoComplete="off" />
            <span className="mt-1 block text-xs text-slate-500">{t("Sustituye a {email} en los textos. Es el mismo que aparece en Ajustes → Acceso con Google.")}</span>
          </label>
        </div>
        <p className="text-xs text-slate-500">{t("Sin valor, ambos se muestran como «el administrador de esta instalación».")}</p>
        <button className="btn-primary w-fit py-1.5" onClick={saveId} disabled={pending || !idDirty}>
          {pending && <Loader2 size={15} className="animate-spin" />} {t("Guardar")}
        </button>
      </section>

      <LegalEditor kind="privacy" title={t("Privacidad")} href="/privacy" settings={settings} editorMode={editorMode} responsible={responsible} email={email} />
      <LegalEditor kind="terms" title={t("Condiciones")} href="/terms" settings={settings} editorMode={editorMode} responsible={responsible} email={email} />
    </div>
  );
}

function LegalEditor({ kind, title, href, settings, editorMode, responsible, email }: { kind: LegalKind; title: string; href: string; settings: LegalSettings; editorMode: EditorModeValue; responsible: string; email: string }) {
  const t = useT();
  const toast = useToast();
  const [pending, start] = useTransition();
  const [saved, setSaved] = useState(settings.texts[kind]);
  const [updatedAt, setUpdatedAt] = useState(settings.updatedAt[kind]);
  const [text, setText] = useState(settings.texts[kind]);
  const [lang, setLang] = useState<Lang>("es");
  const [preview, setPreview] = useState(false);
  const dirty = text.es !== saved.es || text.en !== saved.en;
  const set = (l: Lang, v: string) => setText((s) => ({ ...s, [l]: v.slice(0, LEGAL_MAX) }));

  const picked = pickLegalText(text, lang);
  const previewMd = fillLegalPlaceholders(picked.source === "default" ? defaultLegalMarkdown(kind, lang) : picked.text, picked.locale, responsible, email);

  const save = () =>
    start(async () => {
      const res = await saveLegalPage({ kind, es: text.es, en: text.en }).catch((e) => actionThrowResult(e, t));
      if (!res.ok) return toast(res.error, "error");
      setSaved(res.data.texts);
      setText(res.data.texts);
      setUpdatedAt(res.data.updatedAt);
      toast(t("Guardado."), "success");
    });

  const tabs: [Lang, string][] = [["es", "Español"], ["en", "English"]];
  return (
    <section className="card space-y-3 p-5" data-testid={`legal-editor-${kind}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">{title}</h2>
        <a className="inline-flex items-center gap-1 text-sm text-brand-700 underline dark:text-brand-100" href={href} target="_blank" rel="noopener noreferrer">
          <ExternalLink size={14} /> {t("Ver página pública")}
        </a>
      </div>
      <div role="tablist" className="flex gap-1 border-b border-slate-200 dark:border-slate-800">
        {tabs.map(([l, label]) => (
          <button
            key={l}
            role="tab"
            aria-selected={lang === l}
            className={cn("-mb-px rounded-t-lg border-b-2 px-3 py-1.5 text-sm font-medium", lang === l ? "border-brand-600 text-brand-700 dark:text-brand-100" : "border-transparent text-slate-600 hover:text-slate-900 dark:text-slate-300")}
            onClick={() => setLang(l)}
          >
            {label}
            {text[l].trim() && <span className="ml-1 text-xs text-emerald-600" aria-label={t("Texto propio")}>●</span>}
          </button>
        ))}
      </div>
      <p className="text-xs text-slate-500">
        {lang === "es"
          ? t("Vacío = se usa el texto genérico en español. Puedes usar {responsable} y {email}.")
          : t("Opcional. Vacío = si hay texto propio en español se muestra ese; si no, el texto genérico en inglés. Puedes usar {responsable} y {email}.")}
      </p>
      {preview ? (
        <div className="rounded-lg border border-slate-200 p-4 text-sm dark:border-slate-800" data-testid={`legal-preview-${kind}`}>
          <Markdown>{previewMd}</Markdown>
        </div>
      ) : (
        <div key={lang}>
          <DescriptionField
            mode={editorMode}
            textareaClassName="input field-sizing-content min-h-64 font-mono text-[13px]"
            value={text[lang]}
            onValueChange={(v) => set(lang, v)}
            users={NO_USERS}
            placeholder={t("Texto en Markdown (opcional)")}
          />
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <button className="btn-primary py-1.5" onClick={save} disabled={pending || !dirty}>
          {pending && <Loader2 size={15} className="animate-spin" />} {t("Guardar")}
        </button>
        <button className="btn-secondary py-1.5" onClick={() => setPreview((p) => !p)}>{preview ? t("Volver a editar") : t("Vista previa")}</button>
        <button className="btn-secondary py-1.5" onClick={() => set(lang, defaultLegalMarkdown(kind, lang))} disabled={preview}>{t("Partir del texto por defecto")}</button>
        <button className="btn-secondary py-1.5" onClick={() => set(lang, "")} disabled={!text[lang]}>{t("Restaurar texto por defecto")}</button>
        <span className="text-xs text-slate-400">{text[lang].length.toLocaleString()} / {LEGAL_MAX.toLocaleString()}</span>
      </div>
      {preview && picked.source === "custom-es-fallback" && <p className="text-xs text-amber-600">{t("Sin texto en inglés, los lectores en inglés verán el texto en español.")}</p>}
      <p className="text-xs text-slate-500">
        {updatedAt ? t("Última modificación: {fecha}", { fecha: `${updatedAt.slice(0, 16).replace("T", " ")} UTC` }) : t("Usando el texto genérico.")}
        {dirty && ` ${t("Hay cambios sin guardar.")}`}
      </p>
    </section>
  );
}
