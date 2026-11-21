"use client";

import { useId, useState } from "react";
import { useT } from "@/i18n/client";
import { currentTimeZoneName, matchTimeZone } from "@/lib/time-zones";

/**
 * Zona horaria con búsqueda (`<input list>` + `<datalist>`): sustituye al `<select>` de ~420 zonas sin buscador. Las
 * habituales van arriba con el país al lado (se puede buscar por él: «Colombia», «Canarias»); todas con su nombre actual.
 * `onChange` recibe la zona elegida o "" mientras lo escrito no es ninguna de la lista (el formulario no deja guardar).
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
  const invalid = text.trim() !== "" && matchTimeZone(text, zones) === null;
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
        placeholder={t("Escribe para buscar: Madrid, Bogota…")}
        aria-invalid={invalid || undefined}
        aria-describedby={invalid ? `${id}-error` : undefined}
        onChange={(e) => {
          setText(e.target.value);
          onChange(matchTimeZone(e.target.value, zones) ?? "");
        }}
        // Al salir, lo escrito sin mayúsculas o con espacios («america/new york») se muestra con el nombre de la lista.
        onBlur={() => {
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
