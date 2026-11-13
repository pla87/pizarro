"use client";

import { Mic } from "lucide-react";
import { useDictationSupported } from "@/components/ui/DictationButton";
import { InfoTip } from "@/components/ui/InfoTip";
import { setDictationEnabled, setDictationLangPref, useDictationEnabled, useDictationLangPref } from "@/components/ui/dictation-prefs";
import { useT } from "@/i18n/client";
import { DICTATION_LANGS } from "@/lib/dictation";

/** Mi perfil → Preferencias: botón de dictado por voz (solo en este navegador: depende de su micrófono y de su reconocimiento de voz). */
export function DictationSection() {
  const t = useT();
  const supported = useDictationSupported();
  const enabled = useDictationEnabled();
  const lang = useDictationLangPref();
  return (
    <section className="card p-5">
      <h2 className="flex items-center gap-2 font-semibold"><Mic size={17} /> {t("Dictado por voz")}</h2>
      <p className="mt-0.5 flex items-center gap-1 text-sm text-slate-500">
        {t("Un micrófono en los títulos y descripciones para escribir hablando. Solo en este navegador.")}
        <InfoTip topic={t("Dictado por voz")}>{t("Chrome y Edge envían el audio al servicio de voz de su fabricante; Pizarro no lo recibe ni lo guarda. Sin este botón también puedes dictar con el micrófono del teclado del móvil, Win+H en Windows o el dictado de macOS.")}</InfoTip>
      </p>
      {!supported && <p className="mt-3 text-sm text-amber-700 dark:text-amber-400">{t("Este navegador no admite el dictado (Firefox no lo tiene). Chrome, Edge, Safari y Chrome para Android sí.")}</p>}
      <label className="mt-4 flex items-center gap-2 text-sm">
        <input type="checkbox" className="h-4 w-4 accent-brand-600" checked={enabled} onChange={(e) => setDictationEnabled(e.target.checked)} />
        {t("Mostrar botón de dictado")}
      </label>
      <div className="mt-3 max-w-xs">
        <label className="label" htmlFor="dictation-lang">{t("Idioma del dictado")}</label>
        <select id="dictation-lang" className="input" value={lang} onChange={(e) => setDictationLangPref(e.target.value)}>
          <option value="auto">{t("El de la interfaz")}</option>
          {DICTATION_LANGS.map((l) => <option key={l.code} value={l.code}>{l.label}</option>)}
        </select>
      </div>
    </section>
  );
}
