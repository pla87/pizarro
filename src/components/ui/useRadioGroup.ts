"use client";

import { useRef } from "react";

/**
 * Grupo de opciones con el patrón «radiogroup» de WAI-ARIA: una sola parada de Tab (la opción elegida, o la primera si no
 * hay ninguna) y las flechas (izquierda/arriba = anterior, derecha/abajo = siguiente, dando la vuelta) más Inicio/Fin
 * mueven el foco Y eligen esa opción. Las opciones desactivadas se saltan.
 *
 *   const group = useRadioGroup(options.length, checkedIndex, (i) => choose(options[i]));
 *   <div {...group.groupProps} aria-label="…"> {options.map((o, i) => <button {...group.radioProps(i)} onClick=… />)} </div>
 *
 * `onSelect` se llama con la posición elegida con el teclado (el clic lo gestiona cada opción como siempre).
 */
export function useRadioGroup(count: number, checkedIndex: number, onSelect: (index: number) => void) {
  const ref = useRef<HTMLDivElement>(null);
  const stop = checkedIndex >= 0 && checkedIndex < count ? checkedIndex : 0;

  function onKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.altKey || e.ctrlKey || e.metaKey || e.nativeEvent.isComposing) return;
    const radios = Array.from(ref.current?.querySelectorAll<HTMLElement>('[role="radio"]') ?? []);
    const i = radios.indexOf(document.activeElement as HTMLElement);
    if (i < 0 || !radios.length) return;
    const enabled = (n: number) => !(radios[n] as HTMLButtonElement).disabled;
    const walk = (from: number, step: 1 | -1) => {
      for (let k = 1; k <= radios.length; k++) {
        const n = (from + step * k + radios.length * k) % radios.length;
        if (enabled(n)) return n;
      }
      return -1;
    };
    let next = -1;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") next = walk(i, 1);
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp") next = walk(i, -1);
    else if (e.key === "Home") next = enabled(0) ? 0 : walk(0, 1);
    else if (e.key === "End") next = enabled(radios.length - 1) ? radios.length - 1 : walk(radios.length - 1, -1);
    else return;
    e.preventDefault();
    if (next < 0) return;
    radios[next]!.focus();
    if (next !== checkedIndex) onSelect(next);
  }

  return {
    groupProps: { ref, role: "radiogroup" as const, onKeyDown },
    /** Atributos de la opción `index` (el `aria-checked` y el orden de Tab). */
    radioProps: (index: number) => ({
      role: "radio" as const,
      "aria-checked": index === checkedIndex,
      tabIndex: index === stop ? 0 : -1,
    }),
  };
}
