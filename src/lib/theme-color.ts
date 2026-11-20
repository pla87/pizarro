// Color de la barra de estado (meta theme-color, PWA y navegador del móvil): el del fondo de la página según el tema
// elegido en Pizarro (data-theme en <html>), no el del sistema. Sin dependencias: lo usan el layout raíz (servidor) y
// «Mi perfil» al cambiar el tema.
//
// Siempre van los dos <meta>, uno por cada `media` (claro y oscuro del sistema). Con tema propio los dos llevan su color,
// así que valga el que valga, sale el del tema; con «Sistema», cada uno el suyo. Al cambiar de tema solo se cambia su
// `content`: los <meta> los pinta Next y no deben quitarse ni añadirse a mano.

export const THEME_COLOR = { light: "#f8fafc", dark: "#020617" } as const;

const MEDIA = { light: "(prefers-color-scheme: light)", dark: "(prefers-color-scheme: dark)" } as const;

type Theme = "light" | "dark" | undefined;

/** Los dos theme-color (para `viewport.themeColor`) con el tema elegido; sin tema, el del sistema. */
export function themeColors(theme: Theme): { media: string; color: string }[] {
  return (["light", "dark"] as const).map((scheme) => ({ media: MEDIA[scheme], color: THEME_COLOR[theme ?? scheme] }));
}

/** En el navegador: pone en los <meta name="theme-color"> el color del tema recién elegido. */
export function applyThemeColor(theme: Theme): void {
  for (const { media, color } of themeColors(theme)) {
    const meta = document.head.querySelector<HTMLMetaElement>(`meta[name="theme-color"][media="${media}"]`);
    if (meta) meta.content = color;
  }
}
