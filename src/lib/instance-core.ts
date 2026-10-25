// Parte pura (sin base de datos) de los ajustes de la instalación.
import type { Locale } from "@/i18n/core";
import { validTimeZone } from "./setup-core";

export const INSTANCE_ORG_KEY = "instance.orgName";
export const INSTANCE_LOCALE_KEY = "instance.locale";
export const INSTANCE_TZ_KEY = "instance.timeZone";

export interface InstanceSettings {
  orgName: string;
  locale: Locale;
  timeZone: string;
}

export function parseInstance(rows: { key: string; value: string }[]): InstanceSettings {
  const get = (k: string) => rows.find((r) => r.key === k)?.value ?? "";
  const tz = get(INSTANCE_TZ_KEY);
  return {
    orgName: get(INSTANCE_ORG_KEY).trim().slice(0, 80),
    locale: get(INSTANCE_LOCALE_KEY) === "en" ? "en" : "es",
    timeZone: tz && validTimeZone(tz) ? tz : "",
  };
}
