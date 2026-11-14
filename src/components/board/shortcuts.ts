"use client";

import { useSyncExternalStore } from "react";
import { TYPING_SELECTOR } from "./earlyShortcut";

export function isTypingTarget(target: EventTarget | null): boolean {
  return !!(target as HTMLElement | null)?.closest?.(TYPING_SELECTOR);
}

/** Hay algún modal abierto. */
export function dialogOpen(): boolean {
  return !!document.querySelector("[role=dialog]");
}

/** Tarjeta que espera el foco (focusCard) hasta que pasen los dos fotogramas. */
let awaitingFocus: string | null = null;

/** Devuelve el foco a una tarjeta (p. ej. tras moverla de columna, que la vuelve a montar). */
export function focusCard(taskId: string): void {
  awaitingFocus = taskId;
  // Dos fotogramas: el primero deja que React pinte la tarjeta en su nueva columna. Si se vuelve a montar antes, la propia
  // tarjeta recoge el foco al montarse (takeCardFocus): un atajo pulsado justo después (Alt+→ y enseguida Alt+←) ya no
  // llega al cuerpo de la página y se pierde.
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      if (awaitingFocus === taskId) awaitingFocus = null;
      document.querySelector<HTMLElement>(`[data-task-card="${CSS.escape(taskId)}"]`)?.focus({ preventScroll: false });
    }),
  );
}

/** Al montarse una tarjeta (TaskCard): si es la que espera el foco, lo recibe ya. */
export function takeCardFocus(taskId: string, el: HTMLElement | null): void {
  if (awaitingFocus === taskId && el && document.activeElement !== el) el.focus({ preventScroll: false });
}

/** Evento para que el menú de proyectos (ProjectMenu) se abra desde un atajo. */
export const OPEN_PROJECT_MENU_EVENT = "pz:open-project-menu";

/** Mac (⌘ y ⌥ en vez de Ctrl y Alt). */
function detectMac(): boolean {
  if (typeof navigator === "undefined") return false;
  const nav = navigator as Navigator & { userAgentData?: { platform?: string } };
  return /mac|iphone|ipad/i.test(nav.userAgentData?.platform ?? navigator.platform ?? "");
}

const noopSubscribe = () => () => {};
/** `true` en Mac; en el servidor y durante la hidratación, `false` (sin desajustes). */
function useIsMac(): boolean {
  return useSyncExternalStore(noopSubscribe, detectMac, () => false);
}

/** Texto de un atajo según la plataforma: `shortcutLabel("Alt+N", mac)` da «⌥N» en Mac y «Alt+N» en el resto. */
export function shortcutLabel(keys: string, mac: boolean): string {
  if (!mac) return keys;
  return keys.replace(/Ctrl\+/g, "⌘").replace(/Alt\+/g, "⌥").replace(/Shift\+/g, "⇧");
}

/** Texto de atajo para tooltips: `const sc = useShortcut(); title={`${t("Nueva tarea")} (${sc("Alt+N")})`}`. */
export function useShortcut(): (keys: string) => string {
  const mac = useIsMac();
  return (keys) => shortcutLabel(keys, mac);
}
