// Textos propios de la web estática del producto (getpizarro.com, carpeta site/), además de los de la presentación
// (landing-content.ts). Los usa solo scripts/build-site.mjs, que importa este fichero con Node tal cual: solo
// `import type`, sin alias «@/». Están en src/ para que `npm run i18n:check` compruebe su traducción al inglés
// (src/i18n/en/web.ts, licencia.ts e instalar.ts).
import type { T } from "../i18n/shared";

/** Icono de cada función de la lista compacta (los dibuja scripts/build-site.mjs). */
export type SiteIcon =
  | "calendar" | "inbox" | "docs" | "report" | "flag" | "repeat" | "filter" | "columns" | "lock" | "shield" | "eye" | "export";

/** Integraciones de la portada («Se conecta con…»); build-site les pone icono y enlaces a sus guías. */
export type SiteConnect = "email" | "messaging" | "google-login" | "google-docs";

// `_priceEur`: ya no lo usa ningún texto (el precio está en su sección, con licenseFaq y buyNote); se mantiene la firma.
export function siteText(t: T, _priceEur: number) {
  return {
    metaTitle: t("Pizarro: un tablero Kanban sencillo en tu propio servidor"),
    metaDescription: t("Pizarro es un tablero Kanban sencillo para equipos pequeños y familias. Pagas una vez y es tuyo; tus datos se quedan en tu servidor. Gratis para uso personal y educativo."),
    skip: t("Saltar al contenido"),
    navFeatures: t("Funciones"),
    navWho: t("Para quién"),
    navInstall: t("Instalación"),
    navPricing: t("Precio"),
    navFaq: t("Preguntas"),
    navCta: t("Instalar"),
    menu: t("Menú"),

    // Portada
    heroTitle: t("El tablero sencillo para equipos pequeños y familias"),
    heroLead: t("Pizarro es un Kanban que se instala en tu propio servidor: tareas, comentarios y notas de versión, sin suscripción ni cuota por persona."),
    heroCta: t("Pruébalo gratis"),
    heroSecondary: t("Ver cómo funciona"),
    heroPoints: [t("Gratis para uso personal y educativo"), t("En tu servidor"), t("Sin rastreadores")],
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
        points: [t("Cada tipo de tarea trae sus subtareas y su texto de partida"), t("Coste, horas, cliente o fecha de inicio, solo si los usas")],
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
        points: [t("Comentarios con respuestas y menciones"), t("Avisos en la app, por email o en un resumen diario"), t("Un aviso cuando una tarea lleva días esperando a alguien")],
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
      { icon: "filter" as SiteIcon, title: t("Filtros"), text: t("Lo tuyo, lo vencido o lo de esta semana, y por etiqueta, tipo o persona.") },
      { icon: "columns" as SiteIcon, title: t("Columnas con función"), text: t("Una columna puede sumar el presupuesto, juntar las subtareas en una lista o sacar el PDF de la semana.") },
    ],

    // Integraciones (con enlace a cada guía de conexión)
    connectTitle: t("Se conecta con lo que ya usas"),
    connectLead: t("Todo es opcional: lo activa un administrador cuando hace falta."),
    connect: [
      { key: "email" as SiteConnect, title: t("Avisos por email"), text: t("Invitaciones, menciones, recordatorios y un resumen diario, con Gmail o el correo de tu empresa.") },
      { key: "messaging" as SiteConnect, title: t("Telegram y WhatsApp"), text: t("Los avisos, también en el móvil por Telegram o WhatsApp.") },
      { key: "google-login" as SiteConnect, title: t("Iniciar sesión con Google"), text: t("Entra con tu cuenta de Google, sin otra contraseña que recordar.") },
      { key: "google-docs" as SiteConnect, title: t("Google Docs, Sheets y Slides"), text: t("Crea un documento desde la tarea y queda enlazado en ella.") },
    ],
    connectAll: t("Todas las guías de conexión"),

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
    freeTitle: t("Gratis para uso personal y educativo"),
    freePrice: t("0 €"),
    freeText: t("Para ti y tu familia sin fines comerciales, y para la enseñanza: colegios, institutos, universidades y academias."),
    freePer: t("para siempre"),
    freeItems: [t("Todas las funciones, sin límite de tiempo"), t("Actualizaciones gratis"), t("En tu propio servidor")],
    freeCta: t("Instalar gratis"),
    paidTitle: t("Licencia para cualquier otro uso"),
    paidText: t("Empresas, autónomos y profesionales, asociaciones, administraciones y cualquier otra organización."),
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
    footerSource: t("Pizarro es software de código disponible: puedes leer todo el código. Gratis para uso personal y educativo; para cualquier otro uso necesitas licencia."),
    footerProduct: t("Producto"),
    footerDocs: t("Documentación"),
    footerProject: t("Proyecto"),
    footerManual: t("Manual de uso"),
    footerGuides: t("Guías de conexión"),
    // {site}: la web del autor, enlazada (la pone scripts/build-site.mjs).
    footerBy: t("Un proyecto de {site}"),
    footerManualPdf: t("Manual en PDF"),
    footerChangelog: t("Novedades de cada versión"),
    footerLicense: t("Licencia"),
    footerCode: t("Código en GitHub"),
    installGuide: t("Guía de instalación"),

    // Guías de conexión (índice y cada guía; el texto de cada una sale de docs/guias)
    guidesNav: t("Guías"),
    guidesTitle: t("Guías de conexión"),
    guidesLead: t("Paso a paso para conectar Pizarro con Google, Telegram y WhatsApp. Todo es opcional y lo configura un administrador de tu instalación."),
    guidesDescription: t("Guías paso a paso para conectar Pizarro con Google (inicio de sesión, Docs, Sheets y Slides), Telegram y WhatsApp."),
    guidesInstall: t("¿Aún no has instalado Pizarro?"),
    guideRead: t("Leer la guía"),
    guideOther: t("Otras guías"),
    guideAll: t("Todas las guías"),

    // Guía de instalación (/instalar/, /en/install/; el texto sale de docs/web/instalar.md y docs/web/en/install.md)
    tocTitle: t("En esta página"),
    codeTerminal: t("Terminal"),
    codeVariables: t("Variables"),
    codeOutput: t("Lo que verás"),
    calloutNote: t("Nota"),
    calloutTip: t("Consejo"),
    calloutImportant: t("Importante"),
    calloutWarning: t("Atención"),
    calloutCaution: t("Cuidado"),

    // Licencia y 404
    licenseTitle: t("Licencia de Pizarro"),
    licenseDescription: t("Licencia de código disponible: gratis para uso personal y educativo, y de pago único por servidor para empresas y profesionales."),
    notFoundTitle: t("Página no encontrada"),
    notFoundText: t("Esta dirección no existe en getpizarro.com."),
    notFoundHome: t("Ir al inicio"),
    ogAlt: t("Pizarro: el tablero Kanban sencillo, en tu propio servidor"),
  };
}
