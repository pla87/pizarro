"use client";

import { useId, useRef, useState } from "react";
import { useT } from "@/i18n/client";
import { currentTimeZoneName, matchTimeZone } from "@/lib/time-zones";

/**
 * Zona horaria con búsqueda (`<input list>` + `<datalist>`): sustituye al `<select>` de ~420 zonas sin buscador. Las
 * habituales van arriba con el país al lado (se puede buscar por él: «Colombia», «Canarias»); todas con su nombre actual.
 * `onChange` recibe la zona elegida o "" mientras lo escrito no es ninguna de la lista (el formulario no deja guardar).
 * El aviso «Elige una zona de la lista» sale al salir del campo, también vacío (así se sabe por qué no se puede guardar),
 * y se quita al volver a escribir: antes salía, y se anunciaba, desde la primera letra.
 * Al entrar en el campo con una zona ya elegida, el texto se vacía y la zona queda como placeholder: lo que se escribe es
 * una búsqueda nueva (antes se pegaba detrás: «Europe/Madridbogo») y el desplegable muestra todas. Si se sale con el campo
 * vacío (sin escribir, o borrando lo escrito), vuelve la zona que había.
 */
export function TimeZoneField({ id, value, options, onChange, disabled, className }: {
  id: string;
  /** Zona guardada o elegida (con su nombre actual). */
  value: string;
  /** timeZoneOptions(): las habituales primero. */
  options: readonly string[];
  onChange: (zone: string) => void;
  disabled?: boolean;
  className?: string;
}) {
  const t = useT();
  const listId = `${useId()}-tz`;
  const [text, setText] = useState(currentTimeZoneName(value));
  // Una zona guardada que no está en la lista (p. ej. Etc/GMT+3) sigue siendo elegible.
  const zones = value && !options.includes(value) ? [value, ...options] : options;
  // Se ha salido del campo sin volver a escribir: solo entonces se marca lo que no es una zona de la lista.
  const [left, setLeft] = useState(false);
  // Zona elegida al entrar en el campo: vuelve si se sale con él vacío.
  const atFocus = useRef("");
  const invalid = left && matchTimeZone(text, zones) === null;
  const labels: Record<string, string> = {
    "Europe/Madrid": t("España (península y Baleares)"),
    "Atlantic/Canary": t("Canarias"),
    "Europe/Lisbon": t("Portugal"),
    "Europe/London": t("Reino Unido"),
    "Europe/Paris": t("Francia"),
    "America/New_York": t("EE. UU. (Este)"),
    "America/Chicago": t("EE. UU. (Centro)"),
    "America/Los_Angeles": t("EE. UU. (Pacífico)"),
    "America/Mexico_City": t("México (Centro)"),
    "America/Bogota": t("Colombia"),
    "America/Lima": t("Perú"),
    "America/Santiago": t("Chile"),
    "America/Argentina/Buenos_Aires": t("Argentina"),
    "America/Sao_Paulo": t("Brasil (São Paulo)"),
    UTC: t("Tiempo universal coordinado"),
  };
  return (
    <>
      <input
        id={id}
        className={className ?? "input"}
        list={listId}
        value={text}
        disabled={disabled}
        autoComplete="off"
        spellCheck={false}
        placeholder={value ? currentTimeZoneName(value) : t("Escribe para buscar: Madrid, Bogota…")}
        aria-invalid={invalid || undefined}
        aria-describedby={invalid ? `${id}-error` : undefined}
        onFocus={() => {
          atFocus.current = value;
          if (value && text === currentTimeZoneName(value)) {
            setText("");
            // Sin esto, el error de la salida anterior saldría en cuanto se vacía el campo, sin haber escrito nada.
            setLeft(false);
          }
        }}
        onChange={(e) => {
          setText(e.target.value);
          setLeft(false);
          onChange(matchTimeZone(e.target.value, zones) ?? "");
        }}
        // Al salir, lo escrito sin mayúsculas o con espacios («america/new york») se muestra con el nombre de la lista.
        onBlur={() => {
          // Se entró y se salió sin escribir (o borrándolo todo): la zona que había sigue elegida.
          if (text.trim() === "" && atFocus.current) {
            setText(currentTimeZoneName(atFocus.current));
            if (value !== atFocus.current) onChange(atFocus.current);
            return;
          }
          setLeft(true);
          const zone = matchTimeZone(text, zones);
          if (zone && zone !== text) setText(zone);
        }}
      />
      <datalist id={listId}>
        {zones.map((z) => <option key={z} value={z}>{labels[z]}</option>)}
      </datalist>
      {invalid && <p id={`${id}-error`} className="mt-1 text-xs text-red-600" role="alert">{t("Elige una zona de la lista (por ejemplo, Europe/Madrid).")}</p>}
    </>
  );
}
