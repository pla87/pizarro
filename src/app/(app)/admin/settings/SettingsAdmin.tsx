"use client";

import { Download, Loader2 } from "lucide-react";
import { useState, useTransition } from "react";
import { saveMaxCommentsPerTask } from "@/actions/settings";
import { useToast } from "@/components/ui/Toast";
import { useT } from "@/i18n/client";
import type { MailSettingsView } from "@/lib/mail-config";
import { actionThrowResult } from "@/lib/stale-action";
import { MailSettingsSection } from "./MailSettingsSection";
import { GoogleSettingsSection } from "./GoogleSettingsSection";
import type { GoogleSettingsView } from "@/lib/google-config";

// Mismos márgenes que el servidor (src/lib/app-settings.ts, que no se puede importar desde el cliente).
const MIN = 1;
const MAX = 1000;

/** «Ajustes»: parámetros generales de la aplicación. */
export function SettingsAdmin({ maxComments, mail, google }: { maxComments: number; mail: MailSettingsView; google: GoogleSettingsView }) {
  const t = useT();
  const toast = useToast();
  const [pending, start] = useTransition();
  const [saved, setSaved] = useState(maxComments);
  const [text, setText] = useState(String(maxComments));
  const n = Number(text);
  const valid = text.trim() !== "" && Number.isInteger(n) && n >= MIN && n <= MAX;

  const save = () =>
    start(async () => {
      const res = await saveMaxCommentsPerTask(n).catch((e) => actionThrowResult(e, t));
      if (!res.ok) return toast(res.error, "error");
      setSaved(res.data.value);
      setText(String(res.data.value));
      toast(t("Ajuste guardado."), "success");
    });

  // La ruta comprueba que eres administrador, limita a 5 descargas cada 10 minutos y lo anota en los logs.
  // Se pide con fetch para mostrar el error (p. ej. el límite) en un aviso en vez de descargar el texto del error.
  const [doctorBusy, setDoctorBusy] = useState(false);
  const downloadDoctor = async () => {
    setDoctorBusy(true);
    try {
      const res = await fetch("/api/admin/doctor", { cache: "no-store" });
      if (!res.ok) return toast((await res.text()) || t("Error inesperado. Inténtalo de nuevo."), "error");
      const name = /filename="([^"]+)"/.exec(res.headers.get("Content-Disposition") ?? "")?.[1] ?? "diagnostico-pizarro.json";
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch {
      toast(t("Error inesperado. Inténtalo de nuevo."), "error");
    } finally {
      setDoctorBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-500">{t("Parámetros generales de la aplicación.")}</p>
      <section className="card space-y-3 p-5">
        <div>
          <label htmlFor="max-comments" className="text-sm font-semibold">{t("Máximo de comentarios por tarea")}</label>
          <p className="mt-0.5 text-xs text-slate-500">
            {t("Una tarea que llega al máximo no admite más comentarios. Entre {min} y {max}; por defecto 500. Los comentarios borrados que conservan respuestas no cuentan. Si lo bajas por debajo de lo que ya tiene una tarea, no se borra nada: solo deja de admitir más.", { min: MIN, max: MAX })}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input
            id="max-comments"
            className="input w-28"
            type="number"
            inputMode="numeric"
            min={MIN}
            max={MAX}
            step={1}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && valid && n !== saved && !pending) save();
            }}
          />
          <button className="btn-primary py-1.5" onClick={save} disabled={pending || !valid || n === saved}>
            {pending && <Loader2 size={15} className="animate-spin" />} {t("Guardar")}
          </button>
          {!valid && <span className="text-xs text-red-600">{t("Debe ser un número entero entre {min} y {max}.", { min: MIN, max: MAX })}</span>}
        </div>
      </section>
      <MailSettingsSection initial={mail.settings} env={mail.env} outbox={mail.outbox} />
      <GoogleSettingsSection view={google} />
      <section className="card space-y-3 p-5">
        <div>
          <h2 className="text-sm font-semibold">{t("Diagnóstico para soporte")}</h2>
          <p className="mt-0.5 text-xs text-slate-500">
            {t("Un fichero JSON con el estado técnico de la instalación (versión, base de datos, migraciones, disco, tareas, copias, errores de las últimas 24 h por tipo y qué variables están definidas) para enviarlo a quien te ayude. No lleva datos personales, mensajes de los logs ni el valor de ninguna variable o clave.")}
          </p>
        </div>
        <button className="btn-secondary w-fit py-1.5" onClick={downloadDoctor} disabled={doctorBusy}>
          {doctorBusy ? <Loader2 size={15} className="animate-spin" /> : <Download size={15} />} {t("Descargar diagnóstico")}
        </button>
      </section>
    </div>
  );
}
