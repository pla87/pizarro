// Icono de la app (pestaña, pantalla de inicio del móvil y app instalada) con el color de un tema de color. Parte pura:
// sin base de datos ni sharp, para poder usarla en el cliente (vista previa en Administración) y en las pruebas.

/** Temas de color (los de «Mi perfil → Tema de color», en minúsculas como data-accent). */
export const APP_ICON_ACCENTS = ["blue", "forest", "sienna", "mustard", "mono", "eva"] as const;
export type AppIconAccent = (typeof APP_ICON_ACCENTS)[number];
export const DEFAULT_APP_ICON: AppIconAccent = "blue";

/** Nombre de cada tema (claves de i18n de «Mi perfil»). */
export const APP_ICON_LABEL: Record<AppIconAccent, string> = {
  blue: "Azul",
  forest: "Verde bosque",
  sienna: "Siena",
  mustard: "Mostaza",
  mono: "Blanco y negro",
  eva: "Eva",
};

/**
 * Revisión del dibujo: va en la dirección de cada icono (`?v=`). Súbela si cambias el dibujo o los colores, para que
 * navegadores y móviles no sigan con el de su caché (los iconos se sirven como inmutables).
 */
export const APP_ICON_REV = "1";

/**
 * Colores del logo en cada tema: fondo (brand-600 del tema en claro) y las tres barras (blanco, brand-200 y brand-300,
 * como el icono de siempre en azul; en Eva la del medio es su naranja). Los mismos valores que globals.css.
 */
const PALETTE: Record<AppIconAccent, { bg: string; bars: [string, string, string] }> = {
  blue: { bg: "#4f46e5", bars: ["#ffffff", "#c7d2fe", "#a5b4fc"] },
  forest: { bg: "#1f6b42", bars: ["#ffffff", "#a8d5b8", "#7cc297"] },
  sienna: { bg: "#a2491f", bars: ["#ffffff", "#edbfa5", "#e29c78"] },
  mustard: { bg: "#9a7209", bars: ["#ffffff", "#f2d675", "#e9c24a"] },
  mono: { bg: "#111111", bars: ["#ffffff", "#d0d0d0", "#a0a0a0"] },
  eva: { bg: "#6848a0", bars: ["#ffffff", "#f8a030", "#b690e3"] },
};

/** Color de fondo del icono (también el `theme_color` del manifiesto). */
export const appIconColor = (accent: AppIconAccent): string => PALETTE[accent].bg;

/** Valor guardado (o pedido en la dirección) → tema; cualquier otra cosa, null. */
export function parseAppIcon(raw: string | null | undefined): AppIconAccent | null {
  const v = String(raw ?? "").trim().toLowerCase();
  return (APP_ICON_ACCENTS as readonly string[]).includes(v) ? (v as AppIconAccent) : null;
}

/**
 * Formas del icono. «rounded»: el cuadrado redondeado de siempre (pestaña y manifiesto). «square»: a sangre, sin esquinas
 * (iOS las redondea al añadirlo a la pantalla de inicio y pondría negro en las transparentes). «maskable»: a sangre y con
 * el logo reducido para que quepa en la zona segura (el círculo central del 80 %) con cualquier máscara de Android.
 */
type Shape = "rounded" | "square" | "maskable";

/** Ficheros que se sirven en /app-icon/<tema>/<fichero>. */
export const APP_ICON_FILES = {
  "icon.svg": { shape: "rounded", size: null },
  "icon-32.png": { shape: "rounded", size: 32 },
  "icon-192.png": { shape: "rounded", size: 192 },
  "icon-512.png": { shape: "rounded", size: 512 },
  "icon-maskable-512.png": { shape: "maskable", size: 512 },
  "apple-touch-icon.png": { shape: "square", size: 180 },
} as const satisfies Record<string, { shape: Shape; size: number | null }>;
type AppIconFile = keyof typeof APP_ICON_FILES;

export const isAppIconFile = (name: string): name is AppIconFile => Object.hasOwn(APP_ICON_FILES, name);

/** SVG del icono (en un lienzo de 32×32, como src/app/icon.svg de antes). */
export function appIconSvg(accent: AppIconAccent, shape: Shape = "rounded"): string {
  const { bg, bars } = PALETTE[accent];
  // Las barras, escaladas desde el centro (16,16): a sangre necesitan algo más de aire; en la maskable, la zona segura.
  const scale = shape === "maskable" ? 0.75 : shape === "square" ? 0.9 : 1;
  const frame = shape === "rounded" ? `<rect width="32" height="32" rx="7" fill="${bg}"/>` : `<rect width="32" height="32" fill="${bg}"/>`;
  const bar = (x: number, h: number, fill: string) => `<rect x="${x}" y="7" width="5.5" height="${h}" rx="1.5" fill="${fill}"/>`;
  const content = `${bar(6, 18, bars[0])}${bar(13.25, 12, bars[1])}${bar(20.5, 7, bars[2])}`;
  const body = scale === 1 ? content : `<g transform="translate(16 16) scale(${scale}) translate(-16 -16)">${content}</g>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">${frame}${body}</svg>`;
}

/** Dirección de un icono: el tema va en la ruta y la revisión del dibujo en `?v=` (cambian juntos de dirección). */
export const appIconUrl = (accent: AppIconAccent, file: AppIconFile): string => `/app-icon/${accent}/${file}?v=${APP_ICON_REV}`;

/**
 * Nombre de la app bajo el icono (y en la lista de apps): el de la organización de la instalación si lo hay, así dos
 * instalaciones en el mismo móvil no se llaman igual. El nombre largo lleva siempre «Pizarro».
 */
export function appNames(orgName: string): { name: string; shortName: string } {
  const org = orgName.trim();
  return org ? { name: `${org} · Pizarro`, shortName: org } : { name: "Pizarro", shortName: "Pizarro" };
}
