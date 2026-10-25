import type { Metadata, Viewport } from "next";
import "./globals.css";
import { getCurrentUser } from "@/lib/session";
import { I18nProvider } from "@/i18n/client";
import { getLocale } from "@/i18n/server";
import { appTimeZone } from "@/lib/format";

export const metadata: Metadata = {
  title: { default: "Pizarro", template: "%s · Pizarro" },
  description: "Kanban ligero y generador de release notes para equipos pequeños.",
  robots: { index: false, follow: false },
  applicationName: "Pizarro",
  appleWebApp: { capable: true, title: "Pizarro", statusBarStyle: "default" },
  icons: { apple: "/apple-touch-icon.png" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f8fafc" },
    { media: "(prefers-color-scheme: dark)", color: "#020617" },
  ],
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Sin sesión (p. ej. /login) o tema SYSTEM no hay atributo: se sigue al sistema operativo.
  const user = await getCurrentUser();
  const theme = user?.theme === "LIGHT" ? "light" : user?.theme === "DARK" ? "dark" : undefined;
  // Acento: BLUE (por defecto) no lleva atributo; el resto se pinta como data-accent.
  const accent = user && user.accent !== "BLUE" ? user.accent.toLowerCase() : undefined;
  const locale = await getLocale();
  // data-tz: zona horaria de la app para las fechas del navegador (format.ts), leída al arrancar y no al compilar.
  return (
    <html lang={locale} data-theme={theme} data-accent={accent} data-tz={appTimeZone()}>
      <body>
        <I18nProvider locale={locale}>{children}</I18nProvider>
      </body>
    </html>
  );
}
