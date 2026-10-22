import type { T } from "@/i18n/core";

// Resumen sencillo del User-Agent (navegador y sistema) para mostrar dispositivos; sin dependencias.

export interface DeviceSummary {
  browser: string | null;
  os: string | null;
}

export function summarizeUserAgent(ua: string | null | undefined): DeviceSummary {
  if (!ua) return { browser: null, os: null };
  // Orden importante: Edge, Opera y Chrome en iOS también dicen «Chrome» o «Safari».
  const browser =
    /\bEdg(?:e|A|iOS)?\//.test(ua) ? "Edge"
    : /\bOPR\/|\bOpera\b/.test(ua) ? "Opera"
    : /\bFirefox\/|\bFxiOS\//.test(ua) ? "Firefox"
    : /\bSamsungBrowser\//.test(ua) ? "Samsung Internet"
    : /\bChrome\/|\bCriOS\//.test(ua) ? "Chrome"
    : /\bSafari\//.test(ua) ? "Safari"
    : null;
  const os =
    /\bWindows\b/.test(ua) ? "Windows"
    : /\bAndroid\b/.test(ua) ? "Android"
    : /\biPhone\b|\biPad\b|\biPod\b/.test(ua) ? "iOS"
    : /\bMac OS X\b|\bMacintosh\b/.test(ua) ? "macOS"
    : /\bCrOS\b/.test(ua) ? "ChromeOS"
    : /\bLinux\b|\bX11\b/.test(ua) ? "Linux"
    : null;
  return { browser, os };
}

/** «Chrome en Windows», con los huecos traducidos. */
export function deviceLabel(ua: string | null | undefined, t: T): string {
  const { browser, os } = summarizeUserAgent(ua);
  if (browser && os) return t("{browser} en {os}", { browser, os });
  return browser ?? os ?? t("Dispositivo desconocido");
}
