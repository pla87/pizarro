"use client";

import { createContext, useContext, useMemo } from "react";
import { intlLocale, makeT, type Locale, type T } from "./core";

const I18nContext = createContext<{ locale: Locale; t: T }>({ locale: "es", t: makeT("es") });

export function I18nProvider({ locale, children }: { locale: Locale; children: React.ReactNode }) {
  const value = useMemo(() => ({ locale, t: makeT(locale) }), [locale]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

/** Traductor del usuario actual en componentes de cliente. */
export function useT(): T {
  return useContext(I18nContext).t;
}

export function useLocale(): Locale {
  return useContext(I18nContext).locale;
}

/** Locale de Intl (es-ES / en-GB) para formatear fechas. */
export function useIntlLocale(): string {
  return intlLocale(useContext(I18nContext).locale);
}
