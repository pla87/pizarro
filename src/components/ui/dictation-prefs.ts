"use client";

import { useSyncExternalStore } from "react";

/**
 * Preferencias del dictado, solo de este navegador (localStorage): mostrar el botón y el idioma de reconocimiento
 * («auto» = el de la interfaz). Se guardan aquí y no en la base de datos porque dependen del micrófono y del navegador.
 */
const KEY_ON = "pz-dictation";
const KEY_LANG = "pz-dictation-lang";

const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
function subscribe(cb: () => void) {
  listeners.add(cb);
  const onStorage = (e: StorageEvent) => {
    if (e.key === KEY_ON || e.key === KEY_LANG) cb();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(cb);
    window.removeEventListener("storage", onStorage);
  };
}
// Copia en memoria: si localStorage está bloqueado (ventana privada, datos bloqueados) la preferencia sigue valiendo
// mientras la página esté abierta, en vez de volver al valor por defecto al instante.
const memory = new Map<string, string | null>();
function read(key: string): string | null {
  try {
    const v = localStorage.getItem(key);
    memory.set(key, v);
    return v;
  } catch {
    return memory.get(key) ?? null;
  }
}
function write(key: string, value: string | null) {
  memory.set(key, value);
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* sin almacenamiento: solo queda la copia en memoria */
  }
  emit();
}

/** ¿Se muestra el botón de dictado? Activado por defecto. */
export function useDictationEnabled(): boolean {
  return useSyncExternalStore(subscribe, () => read(KEY_ON) !== "off", () => true);
}
export function setDictationEnabled(on: boolean) {
  write(KEY_ON, on ? null : "off");
}

/** Idioma elegido para dictar, o «auto». */
export function useDictationLangPref(): string {
  return useSyncExternalStore(subscribe, () => read(KEY_LANG) || "auto", () => "auto");
}
export function setDictationLangPref(code: string) {
  write(KEY_LANG, code === "auto" ? null : code);
}
