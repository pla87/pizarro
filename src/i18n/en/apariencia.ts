// Traducciones al inglés: apariencia de la app instalada (Administración → Ajustes → «Icono de la app») y la hora con
// segundos del aviso de reducción de las copias de seguridad.
// Clave: texto exacto en español.
export const apariencia: Record<string, string> = {
  // Icono de la app
  "Icono de la app": "App icon",
  "Color del icono de la app": "App icon color",
  "Color del icono guardado.": "Icon color saved.",
  "El de la pestaña del navegador y el de la app instalada en el móvil o el ordenador. Con un color distinto en cada instalación de Pizarro (p. ej. la del trabajo y la personal), se distinguen a simple vista. Cada persona sigue eligiendo el tema de color de la app en «Mi perfil».":
    "The one in the browser tab and in the app installed on a phone or computer. With a different color in each Pizarro installation (e.g. work and personal), you can tell them apart at a glance. Each person still chooses the app's color theme in “My profile”.",
  "La pestaña cambia al recargar. En Android, la app ya instalada se actualiza sola al cabo de un tiempo (a veces lo pide); en iPhone y iPad hay que quitarla de la pantalla de inicio y volver a añadirla.":
    "The tab changes when you reload. On Android, an app that is already installed updates by itself after a while (sometimes it asks); on iPhone and iPad, remove it from the home screen and add it again.",
  "Cambió el color del icono de la app de {from} a {to}": "Changed the app icon color from {from} to {to}",

  // Copias de seguridad: aviso de reducción
  "Ha llegado una copia nueva: el aviso es ahora de la copia del {date}; el que estabas viendo era de la del {previous}.":
    "A new backup has arrived: the warning is now about the backup from {date}; the one you were looking at was from {previous}.",
  "Copia nueva: {stem} · Última copia buena: {goodStem}": "New backup: {stem} · Last good backup: {goodStem}",
  // Icono de la app: qué nombre lleva debajo, por qué, y etiqueta propia
  "Debajo lleva «{name}», la etiqueta que has escrito.": "Underneath it says “{name}”, the label you wrote.",
  "Debajo lleva «Pizarro»: no hay nombre de la organización.": "Underneath it says “Pizarro”: there is no organization name.",
  "Debajo lleva el nombre de la organización: «{name}».": "Underneath it has the organization name: “{name}”.",
  "Debajo lleva «{name}»: el móvil corta los nombres de más de {max} caracteres, así que de «{org}» se usa {how}.": "Underneath it says “{name}”: phones cut off names longer than {max} characters, so {how} of “{org}” is used.",
  "la primera palabra": "the first word",
  "el principio": "the beginning",
  "Nombre bajo el icono (opcional)": "Name under the icon (optional)",
  "Hasta {max} caracteres, para que el móvil no lo corte. Vacío, se usa el nombre de la organización (recortado si no cabe).": "Up to {max} characters, so the phone doesn't cut it off. Empty, the organization name is used (shortened if it doesn't fit).",
  "Se guardará «{name}».": "“{name}” will be saved.",
  "Nombre bajo el icono guardado.": "Name under the icon saved.",
  "Cambió el nombre bajo el icono de la app de «{from}» a «{to}»": "Changed the name under the app icon from “{from}” to “{to}”",
};
