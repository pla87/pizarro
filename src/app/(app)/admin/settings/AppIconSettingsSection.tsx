"use client";

import { Check, Smartphone } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { saveAppIcon } from "@/actions/settings";
import { cn } from "@/components/ui/cn";
import { InfoTip } from "@/components/ui/InfoTip";
import { useToast } from "@/components/ui/Toast";
import { useRadioGroup } from "@/components/ui/useRadioGroup";
import { useActionTransition } from "@/components/useActionTransition";
import { useT } from "@/i18n/client";
import { APP_ICON_ACCENTS, APP_ICON_LABEL, appIconUrl, appNames, type AppIconAccent } from "@/lib/app-icon-core";

/**
 * «Icono de la app»: el color del icono de esta instalación (pestaña del navegador, pantalla de inicio del móvil y app
 * instalada) y el nombre que lleva debajo. Sirve para distinguir dos instalaciones de Pizarro en el mismo móvil (p. ej.
 * la del trabajo y la personal). Se guarda al elegirlo: con un clic, en el acto; con las flechas, cuando se deja de pulsar
 * (KEYBOARD_SAVE_DELAY_MS), para no guardar cada color por el que se pasa.
 */
/** Con las flechas, el color se guarda tras este rato sin más cambios (la vista previa cambia al momento). */
const KEYBOARD_SAVE_DELAY_MS = 300;
/** Ruta que recibe el color pendiente al cerrar u ocultar la pestaña (con navigator.sendBeacon). */
const APP_ICON_BEACON_URL = "/api/admin/app-icon";

export function AppIconSettingsSection({ initial, orgName }: { initial: AppIconAccent; orgName: string }) {
  const t = useT();
  const toast = useToast();
  const [, start] = useActionTransition();
  const [accent, setAccent] = useState(initial);
  const { shortName } = appNames(orgName);

  // Con las flechas se pasa por varios colores seguidos: la vista previa cambia con cada uno, pero solo se guarda el último,
  // cuando pasan KEYBOARD_SAVE_DELAY_MS sin más cambios (antes se guardaba cada uno: una acción y una línea del registro por
  // color). Lo pendiente se guarda igualmente si el foco sale del grupo o se navega a otra pantalla, y si la página se oculta
  // o se cierra (entonces con sendBeacon: ver flushBeacon).
  /** Último color que el servidor confirmó. */
  const saved = useRef(initial);
  /** Último color enviado (aún sin respuesta, o el confirmado): no se vuelve a enviar el mismo. */
  const sent = useRef(initial);
  /** Color elegido con el teclado que espera a enviarse. */
  const pending = useRef<AppIconAccent | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef(0);
  const save = useCallback((value: AppIconAccent) => {
    if (value === sent.current) return;
    sent.current = value;
    const mine = ++latest.current;
    // Next manda las acciones de una en una: gana la última y, si falla, solo ella vuelve al color que había guardado.
    start(async () => {
      const res = await saveAppIcon(value);
      if (res.ok) saved.current = value;
      if (!res.ok) {
        if (mine === latest.current) {
          sent.current = saved.current;
          // Si entretanto se eligió otro con las flechas (aún sin enviar), ese sigue su curso.
          if (pending.current === null) setAccent(saved.current);
        }
        return toast(res.error, "error");
      }
      if (mine === latest.current) toast(t("Color del icono guardado."), "success");
    });
  }, [start, t, toast]);
  /** Envía ya lo que esté esperando (si lo hay). */
  const flush = useCallback(() => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
    const value = pending.current;
    pending.current = null;
    if (value !== null) save(value);
  }, [save]);
  /**
   * La pestaña se cierra, se recarga o se oculta con un color pendiente: una acción de servidor no llegaría (el navegador
   * corta sus peticiones al descargar la página), así que va con navigator.sendBeacon a /api/admin/app-icon, que sí se
   * entrega después de cerrar. Sin sendBeacon (o si el navegador no lo acepta), como siempre.
   */
  const flushBeacon = useCallback(() => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
    const value = pending.current;
    pending.current = null;
    if (value === null || value === sent.current) return;
    const queued = typeof navigator.sendBeacon === "function" && navigator.sendBeacon(APP_ICON_BEACON_URL, JSON.stringify({ accent: value }));
    if (!queued) return save(value);
    // Sin respuesta que esperar: se da por guardado, y una acción anterior aún en curso que falle ya no lo deshace.
    sent.current = value;
    saved.current = value;
    latest.current++;
  }, [save]);
  const choose = (value: AppIconAccent, how: "click" | "keyboard") => {
    if (value === accent && pending.current === null) return;
    setAccent(value);
    pending.current = value;
    if (how === "click") return flush();
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = setTimeout(flush, KEYBOARD_SAVE_DELAY_MS);
  };
  const group = useRadioGroup(APP_ICON_ACCENTS.length, APP_ICON_ACCENTS.indexOf(accent), (i) => choose(APP_ICON_ACCENTS[i]!, "keyboard"));
  // La última versión de `flush`, para el efecto de abajo (que solo debe montarse y desmontarse una vez).
  const flushRef = useRef(flush);
  const flushBeaconRef = useRef(flushBeacon);
  useEffect(() => {
    flushRef.current = flush;
    flushBeaconRef.current = flushBeacon;
  }, [flush, flushBeacon]);
  useEffect(() => {
    const now = () => flushRef.current();
    const leaving = () => flushBeaconRef.current();
    const hidden = () => {
      if (document.visibilityState === "hidden") leaving();
    };
    // Al cerrar o recargar la pestaña y al cambiar de pestaña o de app (en el móvil no siempre hay «pagehide»).
    window.addEventListener("pagehide", leaving);
    document.addEventListener("visibilitychange", hidden);
    return () => {
      window.removeEventListener("pagehide", leaving);
      document.removeEventListener("visibilitychange", hidden);
      // Al navegar a otra pantalla de la app.
      now();
    };
  }, []);

  return (
    <section id="icono-app" className="card space-y-4 p-5" data-app-icon-settings>
      <div>
        <h2 className="flex items-center gap-1.5 text-base font-semibold">
          <Smartphone size={16} /> {t("Icono de la app")}
          <InfoTip topic={t("Icono de la app")}>
            {t("El de la pestaña del navegador y el de la app instalada en el móvil o el ordenador. Con un color distinto en cada instalación de Pizarro (p. ej. la del trabajo y la personal), se distinguen a simple vista. Cada persona sigue eligiendo el tema de color de la app en «Mi perfil».")}
          </InfoTip>
        </h2>
        <p className="mt-0.5 text-sm text-slate-500">
          {t("Con el nombre de la organización debajo: «{name}».", { name: shortName })}
        </p>
      </div>
      <div
        {...group.groupProps}
        aria-label={t("Color del icono de la app")}
        className="flex flex-wrap gap-3"
        // El foco sale del grupo (Tab, un clic fuera, otra ventana): lo elegido con las flechas se guarda ya.
        onBlur={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget)) flush();
        }}
      >
        {APP_ICON_ACCENTS.map((value, i) => (
          <button
            key={value}
            type="button"
            {...group.radioProps(i)}
            onClick={() => choose(value, "click")}
            data-app-icon={value}
            className={cn(
              "flex w-20 flex-col items-center gap-1.5 rounded-xl p-2 text-xs transition-colors",
              accent === value ? "bg-slate-100 font-semibold ring-2 ring-slate-900 dark:bg-slate-800 dark:ring-slate-100" : "text-slate-600 ring-1 ring-transparent hover:ring-slate-300 dark:text-slate-400 dark:hover:ring-slate-600",
            )}
          >
            <span className="relative">
              {/* eslint-disable-next-line @next/next/no-img-element -- icono pequeño servido por la propia app, sin optimizar */}
              <img src={appIconUrl(value, "icon.svg")} alt="" width={44} height={44} className="h-11 w-11" />
              {accent === value && (
                <span className="absolute -right-1.5 -bottom-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-slate-900 text-white ring-2 ring-white dark:bg-slate-100 dark:text-slate-900 dark:ring-slate-900">
                  <Check size={12} strokeWidth={3} />
                </span>
              )}
            </span>
            {t(APP_ICON_LABEL[value])}
          </button>
        ))}
      </div>
      <p className="text-xs text-slate-500">
        {t("La pestaña cambia al recargar. En Android, la app ya instalada se actualiza sola al cabo de un tiempo (a veces lo pide); en iPhone y iPad hay que quitarla de la pantalla de inicio y volver a añadirla.")}
      </p>
    </section>
  );
}
