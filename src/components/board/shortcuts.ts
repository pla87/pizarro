"use client";

import { useSyncExternalStore } from "react";

/** Elementos donde se está escribiendo: los atajos de una tecla no deben dispararse. */
export const TYPING_SELECTOR = "input, textarea, select, [contenteditable=true], [contenteditable='']";

export function isTypingTarget(target: EventTarget | null): boolean {
  return !!(target as HTMLElement | null)?.closest?.(TYPING_SELECTOR);
}

/** Hay algún modal abierto. */
export function dialogOpen(): boolean {
  return !!document.querySelector("[role=dialog]");
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
export function useIsMac(): boolean {
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
