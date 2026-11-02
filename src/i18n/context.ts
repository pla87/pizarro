"use client";

import { createContext } from "react";
import { esT, type Locale, type T } from "./shared";

export interface I18nValue {
  locale: Locale;
  t: T;
}

export const ES_VALUE: I18nValue = { locale: "es", t: esT };

export const I18nContext = createContext<I18nValue>(ES_VALUE);
