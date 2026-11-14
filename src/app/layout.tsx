import type { Metadata, Viewport } from "next";
import "./globals.css";
import { getCurrentUser } from "@/lib/session";
import { ClientErrorReporter } from "@/components/ClientErrorReporter";
import { VersionWatcher } from "@/components/VersionWatcher";
import { I18nProvider } from "@/i18n/client";
import { getLocale } from "@/i18n/server";
import { appTimeZone } from "@/lib/format";
import { getInstanceSettings } from "@/lib/instance";
import { getAppIcon } from "@/lib/app-icon";
import { appIconUrl, appNames } from "@/lib/app-icon-core";

export async function generateMetadata(): Promise<Metadata> {
  // Nombre de la organización elegido en el asistente de primer arranque (si no, solo «Pizarro»).
  const [{ orgName }, appIcon] = await Promise.all([getInstanceSettings(), getAppIcon()]);
  const { name, shortName } = appNames(orgName);
  return {
    title: { default: name, template: `%s · ${name}` },
    description: "Kanban ligero y generador de release notes para equipos pequeños.",
    robots: { index: false, follow: false },
    applicationName: name,
    // iPhone: «Añadir a pantalla de inicio» copia este nombre y el apple-touch-icon (no lee el manifiesto).
    appleWebApp: { capable: true, title: shortName, statusBarStyle: "default" },
    // Pestaña, pantalla de inicio e iPhone con el color del icono de la instalación (Administración → Ajustes). La
    // dirección cambia con el color (lleva el tema y la revisión del dibujo), así que ninguna caché enseña el anterior.
    icons: {
      icon: [
        { url: appIconUrl(appIcon, "icon.svg"), type: "image/svg+xml" },
        { url: appIconUrl(appIcon, "icon-32.png"), sizes: "32x32", type: "image/png" },
      ],
      apple: [{ url: appIconUrl(appIcon, "apple-touch-icon.png"), sizes: "180x180" }],
    },
  };
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  interactiveWidget: "resizes-content",
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
  // Carga (con caché) los ajustes de la instalación: appTimeZone() usa la zona guardada si no hay APP_TIMEZONE.
  await getInstanceSettings();
  // data-tz: zona horaria de la app para las fechas del navegador (format.ts), leída al arrancar y no al compilar.
  return (
    <html lang={locale} data-theme={theme} data-accent={accent} data-tz={appTimeZone()}>
      <body>
        <I18nProvider locale={locale}>
          {/* En el layout raíz (no solo en la app con sesión): acceso, verificación en dos pasos y demás pantallas públicas también
              deben recargarse tras un despliegue y dejar rastro de sus errores. */}
          <ClientErrorReporter />
          <VersionWatcher />
          {children}
        </I18nProvider>
      </body>
    </html>
  );
}
