"use client";

import { useState } from "react";

interface Option {
  value: string;
  label: string;
}

/**
 * «Periodo» de Administración → Logs: los fijos (última hora, 24 h, 7 días) y «Personalizado…», que muestra «Desde» y
 * «Hasta». Los días son una lista (de hoy a lo que se conservan los logs) con la fecha escrita en el idioma de la
 * interfaz: un `<input type="date">` sale en el formato del navegador (dd/mm/aaaa con la interfaz en inglés).
 */
export function LogPeriodField({ ranges, customValue, value, days, from, to, labels, className }: {
  ranges: Option[];
  customValue: string;
  value: string;
  /** De hoy hacia atrás, ya escritos en el idioma de la interfaz (los pinta el servidor). */
  days: Option[];
  from: string;
  to: string;
  labels: { period: string; custom: string; from: string; to: string };
  className: string;
}) {
  const [range, setRange] = useState(value);
  const label = "flex flex-col gap-1 text-xs text-slate-500";
  return (
    <>
      <label className={label}>
        {labels.period}
        <select name="range" value={range} onChange={(e) => setRange(e.target.value)} className={className}>
          {ranges.map((r) => (
            <option key={r.value} value={r.value}>{r.label}</option>
          ))}
          <option value={customValue}>{labels.custom}</option>
        </select>
      </label>
      {range === customValue && (
        <>
          <label className={label}>
            {labels.from}
            <select name="desde" defaultValue={from} className={className}>
              {days.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
            </select>
          </label>
          <label className={label}>
            {labels.to}
            <select name="hasta" defaultValue={to} className={className}>
              {days.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
            </select>
          </label>
        </>
      )}
    </>
  );
}
