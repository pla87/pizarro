"use client";

import { Loader2 } from "lucide-react";
import { useState, useTransition } from "react";
import { saveMaxCommentsPerTask } from "@/actions/settings";
import { useToast } from "@/components/ui/Toast";
import { useT } from "@/i18n/client";

// Mismos márgenes que el servidor (src/lib/app-settings.ts, que no se puede importar desde el cliente).
const MIN = 1;
const MAX = 1000;

/** «Ajustes»: parámetros generales de la aplicación. */
export function SettingsAdmin({ maxComments }: { maxComments: number }) {
  const t = useT();
  const toast = useToast();
  const [pending, start] = useTransition();
  const [saved, setSaved] = useState(maxComments);
  const [text, setText] = useState(String(maxComments));
  const n = Number(text);
  const valid = text.trim() !== "" && Number.isInteger(n) && n >= MIN && n <= MAX;

  const save = () =>
    start(async () => {
      const res = await saveMaxCommentsPerTask(n).catch(() => ({ ok: false as const, error: t("Error inesperado. Inténtalo de nuevo.") }));
      if (!res.ok) return toast(res.error, "error");
      setSaved(res.data.value);
      setText(String(res.data.value));
      toast(t("Ajuste guardado."), "success");
    });

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
    </div>
  );
}
