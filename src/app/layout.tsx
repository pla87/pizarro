import type { Metadata, Viewport } from "next";
import "./globals.css";
import { getCurrentUser } from "@/lib/session";
import { ClientErrorReporter } from "@/components/ClientErrorReporter";
import { VersionWatcher } from "@/components/VersionWatcher";
import { I18nProvider } from "@/i18n/client";
import { getLocale, getT } from "@/i18n/server";
import { appTimeZone } from "@/lib/format";
import { themeColors } from "@/lib/theme-color";
import { getInstanceSettings } from "@/lib/instance";
import { getAppIcon } from "@/lib/app-icon";
import { appIconUrl, appNames } from "@/lib/app-icon-core";

export async function generateMetadata(): Promise<Metadata> {
  // Nombre de la organización elegido en el asistente de primer arranque (si no, solo «Pizarro»).
  const [{ orgName }, appIcon, t] = await Promise.all([getInstanceSettings(), getAppIcon(), getT()]);
  const { name, shortName } = appNames(orgName);
  return {
    title: { default: name, template: `%s · ${name}` },
    // La misma frase que el manifiesto de la app (web-manifest.ts), en el idioma de la petición (sin sesión, el de la instalación).
    description: t("Kanban ligero y generador de release notes."),
    robots: { index: false, follow: false },
    // Safari de iOS convierte en enlaces lo que parece un teléfono, una dirección o un email (una IP de «Sesiones abiertas»,
    // un número de tarea): cambia el HTML antes de que React lo hidrate y da el error #418.
    formatDetection: { telephone: false, address: false, email: false },
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

/** Tema elegido por quien tiene la sesión (sin sesión o «Sistema»: ninguno, se sigue al sistema operativo). */
async function userTheme(): Promise<"light" | "dark" | undefined> {
  const user = await getCurrentUser();
  return user?.theme === "LIGHT" ? "light" : user?.theme === "DARK" ? "dark" : undefined;
}

export async function generateViewport(): Promise<Viewport> {
  return {
    width: "device-width",
    initialScale: 1,
    viewportFit: "cover",
    interactiveWidget: "resizes-content",
    // Barra de estado (PWA, móvil) con el fondo del tema elegido en Pizarro; con «Sistema», el del sistema (theme-color.ts).
    themeColor: themeColors(await userTheme()),
  };
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Sin sesión (p. ej. /login) o tema SYSTEM no hay atributo: se sigue al sistema operativo.
  const user = await getCurrentUser();
  const theme = await userTheme();
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
