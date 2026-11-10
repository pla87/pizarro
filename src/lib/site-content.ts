// Textos propios de la web estática del producto (getpizarro.com, carpeta site/), además de los de la presentación
// (landing-content.ts). Los usa solo scripts/build-site.mjs, que importa este fichero con Node tal cual: solo
// `import type`, sin alias «@/». Están en src/ para que `npm run i18n:check` compruebe su traducción al inglés
// (src/i18n/en/web2.ts y licencia2.ts).
import type { T } from "../i18n/shared";

/** Icono de cada función de la lista compacta (los dibuja scripts/build-site.mjs). */
export type SiteIcon =
  | "calendar" | "inbox" | "docs" | "report" | "flag" | "repeat" | "mic" | "phone" | "google" | "undo" | "palette" | "globe"
  | "lock" | "shield" | "eye" | "export";

export function siteText(t: T, priceEur: number) {
  return {
    metaTitle: t("Pizarro: un tablero Kanban sencillo en tu propio servidor"),
    metaDescription: t("Pizarro es un tablero Kanban sencillo para equipos pequeños y familias. Pagas una vez y es tuyo; tus datos se quedan en tu servidor. Gratis para uso personal."),
    skip: t("Saltar al contenido"),
    navFeatures: t("Funciones"),
    navWho: t("Para quién"),
    navInstall: t("Instalación"),
    navPricing: t("Precio"),
    navFaq: t("Preguntas"),
    navCta: t("Instalar"),
    menu: t("Menú"),

    // Portada
    eyebrow: t("Kanban en tu servidor · pago único"),
    heroTitle: t("El tablero sencillo para equipos pequeños y familias"),
    heroLead: t("Pizarro es un Kanban que se instala en tu propio servidor: tareas, comentarios y notas de versión, sin suscripción ni cuota por persona. Gratis para uso personal y {price} € una sola vez para trabajar.", { price: priceEur }),
    heroCta: t("Pruébalo gratis"),
    heroSecondary: t("Ver cómo funciona"),
    heroPoints: [t("Pago único"), t("En tu servidor"), t("Sin rastreadores")],
    heroAlt: t("El tablero de Pizarro con las columnas Por hacer, En curso, Revisión, Siguiente release y Hecho, y tarjetas con responsable, fecha, etiquetas y subtareas"),

    // Problema y solución
    whyKicker: t("Por qué Pizarro"),
    whyTitle: t("Para organizar a cinco personas no hace falta una herramienta enorme"),
    whyText: t("Las aplicaciones de proyectos crecen cada año: más menús, más opciones y una factura que sube con cada persona que invitas. Pizarro va en la dirección contraria: hace pocas cosas, las hace bien y es tuyo."),
    whyPoints: [
      { title: t("Se entiende a la primera"), text: t("Un tablero, columnas y tarjetas. Quien lo abre por primera vez sabe qué hacer, sin cursos ni manuales.") },
      { title: t("Pagas una vez y es tuyo para siempre"), text: t("Sin suscripción y sin cuota por usuario. Las actualizaciones son gratis para siempre.") },
      { title: t("Tus datos son tuyos"), text: t("Viven en tu propio servidor, sin rastreadores, y no salen de ahí. Con copias de seguridad cifradas.") },
    ],

    // Cómo funciona: bloques con captura
    howKicker: t("Cómo funciona"),
    howTitle: t("Todo el trabajo del equipo, de un vistazo"),
    howLead: t("Lo justo para organizarse, bien resuelto. Estas capturas son de la aplicación real."),
    blocks: [
      {
        key: "task",
        kicker: t("Tareas"),
        title: t("Cada tarea, con todo lo que necesita"),
        text: t("Cada columna es una fase y cada tarjeta, una tarea. Arrástralas según avanzan; al abrir una tienes la descripción, las subtareas, los archivos y la conversación en el mismo sitio."),
        points: [t("Subtareas con barra de progreso"), t("Tipos, etiquetas y prioridad"), t("Fechas límite que cambian de color al acercarse"), t("Tareas que se repiten solas")],
        alt: t("Detalle de una tarea con descripción, subtareas a medio hacer, etiquetas, fecha límite y comentarios"),
      },
      {
        key: "release",
        kicker: t("Notas de versión"),
        title: t("Las notas de la versión se escriben solas"),
        text: t("Cuando una tanda de trabajo está lista, pulsa «Generar release»: Pizarro reúne las tareas terminadas, las agrupa por tipo, les pone un código y añade tu cabecera y tu pie. Lo repasas, lo copias y queda guardado en el historial."),
        points: [t("Texto en Markdown listo para copiar o descargar"), t("Los adjuntos de las tareas, renombrados en un ZIP"), t("Historial de releases con buscador")],
        alt: t("Notas de versión generadas por Pizarro: cabecera, tareas agrupadas en Funcionalidad, Corrección y Mejora con su código, y pie"),
      },
      {
        key: "comments",
        kicker: t("Colaboración"),
        title: t("En equipo, cada uno desde su sitio"),
        text: t("Comenta en la tarea y menciona a alguien con @: le llega el aviso en la app o por email. Lo que cambia otra persona aparece en tu pantalla al momento, sin recargar."),
        points: [t("Comentarios con respuestas y menciones"), t("Avisos en la app, por email o en un resumen diario"), t("Sigue una tarea para no perderte nada"), t("Ctrl+Z deshace cualquier cambio")],
        alt: t("Comentarios de una tarea con una respuesta y una mención a medio escribir que sugiere a una persona del equipo"),
      },
    ],
    mobileKicker: t("Móvil y voz"),
    mobileTitle: t("En el bolsillo, y sin teclear"),
    mobileText: t("Pizarro se instala desde el navegador como una app en Android, iPhone y escritorio. En el móvil ves una columna cada vez y cambias de una a otra deslizando el dedo. Y si no te apetece escribir, dicta la tarea."),
    mobilePoints: [t("App instalable, sin tiendas de aplicaciones"), t("Dictado por voz en títulos y descripciones"), t("Tus fechas en el calendario del móvil")],
    mobileAltBoard: t("El tablero en un móvil, con las pestañas de las columnas y las tarjetas de la columna En curso"),
    mobileAltTask: t("El detalle de una tarea en un móvil"),

    // Privacidad
    privacyKicker: t("Privacidad"),
    privacyTitle: t("Tus datos, en tu servidor"),
    privacyText: t("Pizarro se instala en un servidor tuyo o de tu empresa. No hay una nube intermedia ni analítica: lo que escribes se queda allí."),
    privacyItems: [
      { icon: "lock" as SiteIcon, title: t("Copias de seguridad cifradas"), text: t("Automáticas y cifradas, en el propio servidor o en un almacenamiento S3 aparte.") },
      { icon: "shield" as SiteIcon, title: t("Verificación en dos pasos"), text: t("Con una app de códigos o por email; obligatoria para los administradores.") },
      { icon: "eye" as SiteIcon, title: t("Sin rastreadores"), text: t("Ni publicidad, ni analítica, ni cookies de terceros. Esta web tampoco las tiene.") },
      { icon: "export" as SiteIcon, title: t("Entra y sal cuando quieras"), text: t("Exporta un proyecto entero con sus tareas y archivos, o tráete tus tableros de Trello o de un CSV.") },
    ],

    // Lista compacta de funciones
    featuresTitle: t("Y todo lo demás que hace falta"),
    featuresLead: t("Sin módulos ni planes: todo viene incluido desde el primer día."),
    calendarAlt: t("Calendario mensual de Pizarro con las tareas de cada día coloreadas por tipo"),
    features: [
      { icon: "calendar" as SiteIcon, title: t("Calendario"), text: t("Arrastra tareas de un día a otro y suscríbete desde el calendario del móvil.") },
      { icon: "inbox" as SiteIcon, title: t("Mis tareas"), text: t("Tu bandeja del día con lo que llevas en todos los proyectos.") },
      { icon: "docs" as SiteIcon, title: t("Documentación"), text: t("Documentos y archivos de cada proyecto, junto a sus tareas.") },
      { icon: "report" as SiteIcon, title: t("Informe PDF"), text: t("El estado del proyecto en una página, también por email cada semana.") },
      { icon: "flag" as SiteIcon, title: t("Entregables"), text: t("Hitos con fecha y su avance, en el calendario y en el informe.") },
      { icon: "repeat" as SiteIcon, title: t("Tareas que se repiten"), text: t("Cada día, cada semana o cada mes, sin volver a crearlas.") },
      { icon: "mic" as SiteIcon, title: t("Dictado por voz"), text: t("Crea y describe tareas hablando, sin teclear.") },
      { icon: "phone" as SiteIcon, title: t("App en el móvil"), text: t("Se instala desde el navegador como una app, en Android, iPhone y escritorio.") },
      { icon: "google" as SiteIcon, title: t("Google Docs y Sheets"), text: t("Crea un documento desde la tarea y queda enlazado en ella.") },
      { icon: "undo" as SiteIcon, title: t("Deshacer"), text: t("Mover, borrar o archivar: todo se puede deshacer.") },
      { icon: "palette" as SiteIcon, title: t("Temas y colores"), text: t("Claro u oscuro, y el color de acento que prefiera cada persona.") },
      { icon: "globe" as SiteIcon, title: t("Español e inglés"), text: t("Cada persona usa Pizarro en su idioma.") },
    ],

    // Para quién
    whoTitle: t("Pensado para grupos pequeños"),
    whoLead: t("Para unas pocas personas que quieren ponerse de acuerdo sin montar una herramienta enorme."),
    who: [
      { title: t("Equipos pequeños"), text: t("Equipos de software, agencias y estudios de unas pocas personas. Del primer apunte a la versión publicada, con sus notas."), example: t("Ejemplo «Equipo de software»: ideas, revisión y releases.") },
      { title: t("Autónomos y profesionales"), text: t("Encargos por cliente con su coste y sus horas, presupuestos que se suman solos y proyectos privados para lo tuyo."), example: t("Ejemplo «Empresa y clientes»: presupuestos y encargos.") },
      { title: t("Familias"), text: t("La lista de la compra, las citas del médico y las tareas de casa, con rutinas que se repiten cada semana. Gratis para uso personal."), example: t("Ejemplo «Familia y casa»: compras, citas y rutinas.") },
    ],
    whoNote: t("Al crear un proyecto puedes empezar desde un ejemplo listo para usar, con sus columnas y tarjetas de muestra."),

    // Precio
    pricingTitle: t("Un precio, una sola vez"),
    pricingLead: t("Las dos modalidades tienen todas las funciones: solo cambia para qué usas Pizarro."),
    freeTitle: t("Gratis para uso personal"),
    freePrice: t("0 €"),
    freeText: t("Para ti y tu familia, sin fines comerciales."),
    freePer: t("para siempre"),
    freeItems: [t("Todas las funciones, sin límite de tiempo"), t("Actualizaciones gratis"), t("En tu propio servidor")],
    freeCta: t("Instalar gratis"),
    paidTitle: t("Licencia para cualquier otro uso"),
    paidText: t("Empresas, autónomos y profesionales, asociaciones, centros educativos y cualquier otra organización."),
    paidItems: [t("Sin suscripción ni cuota por usuario"), t("Todas las actualizaciones futuras, gratis"), t("Un servidor, tantas personas como quieras"), t("Sin soporte incluido")],
    buy: t("Comprar licencia"),
    soon: t("Próximamente"),
    soonNote: t("Mientras tanto puedes usar Pizarro con normalidad: la licencia se basa en la buena voluntad."),
    readLicense: t("Lee la licencia"),

    faqTitle: t("Preguntas frecuentes"),

    // Instalación
    installKicker: t("Instalación"),
    installTitle: t("Funcionando en unos minutos"),
    installLead: t("En un Linux con Docker, 1 GB de RAM y un dominio que apunte al servidor, un solo comando instala Pizarro con su base de datos y HTTPS. Repetirlo lo actualiza y conserva tus datos."),
    copy: t("Copiar"),
    copied: t("Copiado"),
    installLinks: [
      { key: "guide", title: t("Guía de instalación"), text: t("Paso a paso: requisitos, dominio, copias de seguridad y actualizaciones.") },
      { key: "image", title: t("Imagen Docker"), text: t("Cada versión, ya construida para amd64 y arm64.") },
      { key: "railway", title: t("Railway"), text: t("Sin servidor propio: Pizarro y su base de datos, desde el repositorio.") },
    ],

    // Pie
    footerTagline: t("Un tablero Kanban sencillo para equipos pequeños y familias, en tu propio servidor."),
    footerSource: t("Pizarro es software de código disponible: puedes leer todo el código. Gratis para uso personal; para cualquier otro uso necesitas licencia."),
    footerProduct: t("Producto"),
    footerDocs: t("Documentación"),
    footerProject: t("Proyecto"),
    footerManual: t("Manual de uso"),
    footerManualPdf: t("Manual en PDF"),
    footerChangelog: t("Novedades de cada versión"),
    footerLicense: t("Licencia"),
    footerCode: t("Código en GitHub"),
    installGuide: t("Guía de instalación"),

    // Licencia y 404
    licenseTitle: t("Licencia de Pizarro"),
    licenseDescription: t("Licencia de código disponible: gratis para uso personal y de pago único por servidor para empresas y profesionales."),
    notFoundTitle: t("Página no encontrada"),
    notFoundText: t("Esta dirección no existe en getpizarro.com."),
    notFoundHome: t("Ir al inicio"),
    ogAlt: t("Pizarro: el tablero Kanban sencillo, en tu propio servidor"),
  };
}
