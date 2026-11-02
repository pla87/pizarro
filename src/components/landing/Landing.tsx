import Link from "next/link";
import {
  ArrowRight, Bell, BookOpen, Briefcase, CalendarDays, CalendarPlus, CalendarRange, ClipboardCheck, Code, Columns3, DatabaseBackup, FileDown, House, Hourglass, Languages, ListChecks,
  Mic, Minus, Package, Terminal, BellRing, FileText, Repeat, Rocket, Send, ShieldCheck, SlidersHorizontal, Smartphone, Mail, Wallet, Check,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { Locale, T } from "@/i18n/core";
import { BrandMark } from "@/components/ui/BrandMark";
import { LandingDemoLoader } from "./LandingDemoLoader";

export const REPO_URL = "https://github.com/pla87/pizarro";
export const INSTALL_URL = `${REPO_URL}/blob/main/docs/INSTALL.md`;

interface Item {
  icon: LucideIcon;
  title: string;
  text: string;
}

function SectionTitle({ id, title, lead }: { id: string; title: string; lead?: string }) {
  return (
    <div className="mb-8 max-w-2xl">
      <h2 id={id} className="scroll-mt-20 text-2xl font-bold tracking-tight sm:text-3xl">{title}</h2>
      {lead && <p className="mt-2 text-slate-600 dark:text-slate-400">{lead}</p>}
    </div>
  );
}

function IconBox({ icon: Icon }: { icon: LucideIcon }) {
  return (
    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-600 dark:bg-brand-500/15 dark:text-brand-300">
      <Icon size={18} aria-hidden />
    </span>
  );
}

export function Landing({ t, locale, contactEmail }: { t: T; locale: Locale; contactEmail: string }) {
  const other = locale === "es" ? "en" : "es";

  const features: Item[] = [
    { icon: Columns3, title: t("Tablero Kanban"), text: t("Arrastra y suelta las tarjetas entre columnas y deshaz o rehaz cualquier cambio.") },
    { icon: Rocket, title: t("Releases con notas generadas"), text: t("Las tareas de «Siguiente salto» se convierten en notas de release agrupadas por tipo, con un ZIP de los adjuntos. Las tareas fijas entran en todas las releases.") },
    { icon: SlidersHorizontal, title: t("Campos opcionales"), text: t("Activa solo lo que necesitas en cada proyecto: coste, horas, prioridad, cliente y fecha de inicio.") },
    { icon: CalendarRange, title: t("Calendario"), text: t("Vista mensual con las tareas por fecha límite y franjas que se arrastran para cambiar las fechas.") },
    { icon: BookOpen, title: t("Documentación del proyecto"), text: t("Guarda guías, PDF e imágenes del proyecto y míralos en un visor sin salir de la app.") },
    { icon: Mic, title: t("Dictado por voz"), text: t("Dicta el título y la descripción de las tareas con el micrófono del navegador.") },
    { icon: Bell, title: t("Avisos por email y WhatsApp"), text: t("Menciones, asignaciones, cambios de fecha y comentarios llegan a la app y, si lo activas, al email o a WhatsApp.") },
    { icon: ShieldCheck, title: t("Acceso seguro"), text: t("Inicio de sesión con Google o con contraseña y verificación en dos pasos con app de autenticación o código por email.") },
    { icon: Package, title: t("Exportar e importar proyectos"), text: t("Descarga un proyecto con sus adjuntos y su histórico, o importa uno desde un archivo.") },
    { icon: DatabaseBackup, title: t("Copias de seguridad cifradas"), text: t("Copias diarias cifradas y una prueba mensual que restaura de verdad la última copia para comprobar que sirve.") },
    { icon: Smartphone, title: t("App instalable en el móvil"), text: t("Instálala desde el navegador, sin tienda de aplicaciones, con una vista pensada para el móvil.") },
    { icon: Terminal, title: t("Instalación en un paso"), text: t("Un solo comando en tu servidor con Docker, o la plantilla de Railway. Repetirlo actualiza a la última versión.") },
    { icon: BellRing, title: t("Actualizaciones con aviso"), text: t("La app avisa a los administradores cuando hay una versión nueva, con lo que cambia en ella.") },
    { icon: FileText, title: t("Plantillas de release"), text: t("Cabeceras y pies reutilizables para las notas de release, en español o en inglés.") },
    { icon: Languages, title: t("Español e inglés"), text: t("Cada persona elige su idioma; también las notas de release y los tipos de tarea de serie.") },
  ];

  const specials: Item[] = [
    { icon: Hourglass, title: t("Esperando"), text: t("Avisa a la persona responsable cuando una tarea lleva los días que elijas sin moverse.") },
    { icon: CalendarDays, title: t("Planificación semanal"), text: t("PDF de la semana por día o por persona.") },
    { icon: ListChecks, title: t("Lista consolidada"), text: t("Reúne las subtareas de todas las tarjetas en una sola lista: la compra, la maleta, materiales.") },
    { icon: ClipboardCheck, title: t("Revisión con requisitos"), text: t("Avisa de las subtareas sin marcar antes de sacar una tarjeta de la columna.") },
    { icon: CalendarPlus, title: t("Agenda"), text: t("Exporta las tareas con fecha a un archivo .ics para Google Calendar, Apple u Outlook.") },
    { icon: Repeat, title: t("Rutinas"), text: t("Tareas recurrentes: al terminar una, aparece la siguiente.") },
    { icon: Send, title: t("Entrega al cliente"), text: t("Resumen en PDF para el cliente, sin descripciones, comentarios ni responsables.") },
    { icon: Wallet, title: t("Presupuesto"), text: t("Suma el coste de las tareas y resume lo pagado y lo pendiente.") },
  ];

  const products = ["Pizarro", "Trello", "Asana", "Notion", "Jira"];
  const rows: { label: string; cells: string[] }[] = [
    { label: t("Alojamiento y datos"), cells: [t("En tu propio servidor: tus datos son tuyos"), t("Servicio en la nube"), t("Servicio en la nube"), t("Servicio en la nube"), t("Nube; Data Center para grandes organizaciones")] },
    { label: t("Modelo de precio"), cells: [t("Autoalojado: sin cuota por usuario, pagas tu servidor"), t("Suscripción por usuario, con plan gratuito limitado"), t("Suscripción por usuario, con plan gratuito limitado"), t("Suscripción por usuario, con plan gratuito limitado"), t("Suscripción por usuario, con plan gratuito limitado")] },
    { label: t("Notas de release generadas"), cells: [t("De serie, desde la columna «Siguiente salto»"), t("No de serie"), t("No de serie"), t("No de serie"), t("Sí, a partir de las versiones del proyecto")] },
    { label: t("Columnas con comportamiento propio"), cells: [t("Once roles: esperando, rutinas, presupuesto, agenda…"), t("Con automatizaciones que configuras tú"), t("Con reglas que configuras tú"), t("Con automatizaciones que configuras tú"), t("Con automatizaciones que configuras tú")] },
    { label: t("Verificación en dos pasos y Google"), cells: [t("De serie: dos pasos e inicio con Google"), t("Dos pasos; SSO según el plan"), t("Dos pasos; SSO según el plan"), t("Dos pasos; SSO según el plan"), t("Dos pasos; SSO según el plan")] },
    { label: t("En el móvil"), cells: [t("App instalable desde el navegador (PWA)"), t("Apps en las tiendas"), t("Apps en las tiendas"), t("Apps en las tiendas"), t("Apps en las tiendas")] },
    { label: t("Complejidad"), cells: [t("Ligera, para equipos pequeños (hasta 10 personas)"), t("Sencilla"), t("Amplia; más que aprender"), t("Muy flexible; hay que montarla"), t("Muy completa; la más compleja")] },
    { label: t("Integraciones y escala"), cells: [t("Pocas: Google, email y WhatsApp"), t("Muchas, con extensiones"), t("Muchas, para grandes equipos"), t("Muchas, con su propio ecosistema"), t("Un ecosistema enorme, para grandes organizaciones")] },
  ];

  const audiences: { icon: LucideIcon; title: string; text: string; examples: string[] }[] = [
    {
      icon: House,
      title: t("Familias"),
      text: t("Reparte las tareas de casa, planifica la semana y ten a mano la compra y la maleta."),
      examples: [t("Plantilla «Tareas familiares»"), t("Lista consolidada para la compra o el viaje"), t("Rutinas para lo que se repite cada semana"), t("Planificación semanal en PDF por persona")],
    },
    {
      icon: Briefcase,
      title: t("Pequeños negocios"),
      text: t("Controla encargos, clientes y cobros sin pagar una licencia por cada persona."),
      examples: [t("Plantillas «Negocio» y «Producción audiovisual»"), t("Esperando, para lo que depende del cliente"), t("Presupuesto con lo pagado y lo pendiente"), t("Resumen en PDF para entregar al cliente")],
    },
    {
      icon: Code,
      title: t("Equipos de desarrollo"),
      text: t("Del tablero a la release: lo que sale en cada despliegue queda registrado y explicado."),
      examples: [t("Plantilla «Vibecoding»"), t("Notas de release generadas y editables"), t("Tareas fijas en cada despliegue"), t("Revisión con requisitos antes de pasar de columna")],
    },
  ];

  const steps: { title: string; text: string }[] = [
    { title: t("Prepara un servidor"), text: t("Un Linux con Docker, 1 GB de RAM y un dominio apuntando a él (o tu red local, sin dominio).") },
    { title: t("Ejecuta un comando"), text: t("El script instala Pizarro, la base de datos y el certificado HTTPS, y deja una copia de recuperación.") },
    { title: t("Crea tu cuenta"), text: t("Abre la dirección, crea el administrador en el asistente y empieza con una plantilla de proyecto.") },
  ];

  const faq: { q: string; a: string }[] = [
    { q: t("¿Dónde están mis datos y quién los ve?"), a: t("En la base de datos y los ficheros de tu servidor. Pizarro no tiene rastreadores ni analítica y no envía tus datos a terceros; solo usa los servicios que actives tú, como el correo o Google para iniciar sesión.") },
    { q: t("¿Hay cuota por usuario?"), a: t("No. Puedes invitar a quien quieras; el límite lo pone tu servidor. Está pensada para equipos pequeños, de hasta unas diez personas.") },
    { q: t("¿Qué servidor necesito?"), a: t("Linux x86_64 o arm64 con Docker, 1 GB de RAM y los puertos 80 y 443. También puedes desplegarla en Railway.") },
    { q: t("¿Y las copias de seguridad?"), a: t("Se hacen cada día, cifradas, hacia un destino que eliges (un almacenamiento S3 compatible o una carpeta). Una vez al mes se restaura la última de verdad para comprobar que sirve.") },
    { q: t("¿En qué idiomas está?"), a: t("Español e inglés. Cada persona elige el suyo, y también las notas de release y los tipos de tarea de serie.") },
    { q: t("¿Cómo se actualiza?"), a: t("Repitiendo el comando de instalación, que conserva tus datos. La app avisa a los administradores cuando hay una versión nueva.") },
  ];

  return (
    <div data-testid="landing">
      <header className="sticky top-0 z-40 border-b border-slate-200 bg-slate-50/90 backdrop-blur dark:border-slate-800 dark:bg-slate-950/90">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-2.5">
          <Link href="/presentacion" className="mr-auto flex items-center gap-2 font-bold tracking-tight">
            <BrandMark size={28} /> Pizarro
          </Link>
          <nav className="hidden items-center gap-5 text-sm text-slate-600 md:flex dark:text-slate-300" aria-label={t("Secciones")}>
            <a href="#funciones" className="hover:text-brand-600 dark:hover:text-brand-300">{t("Funciones")}</a>
            <a href="#comparativa" className="hover:text-brand-600 dark:hover:text-brand-300">{t("Comparativa")}</a>
            <a href="#para-quien" className="hover:text-brand-600 dark:hover:text-brand-300">{t("Para quién")}</a>
            <a href="#demo" className="hover:text-brand-600 dark:hover:text-brand-300">{t("Demo")}</a>
            <a href="#instalacion" className="hover:text-brand-600 dark:hover:text-brand-300">{t("Instalación")}</a>
            <a href="#precios" className="hover:text-brand-600 dark:hover:text-brand-300">{t("Precios")}</a>
            <a href="#preguntas" className="hover:text-brand-600 dark:hover:text-brand-300">{t("Preguntas")}</a>
          </nav>
          <a href={`?lang=${other}`} hrefLang={other} lang={other} className="btn-ghost px-2" data-testid="landing-lang" aria-label={other === "en" ? "English" : "Español"}>{other.toUpperCase()}</a>
          <Link href="/login" className="btn-secondary whitespace-nowrap">{t("Iniciar sesión")}</Link>
        </div>
      </header>

      <main>
        <section className="mx-auto max-w-6xl px-4 pt-12 pb-14 sm:pt-20 sm:pb-20">
          <p className="mb-3 inline-flex items-center gap-1.5 rounded-full bg-brand-50 px-3 py-1 text-xs font-semibold text-brand-700 dark:bg-brand-500/15 dark:text-brand-300">
            <ShieldCheck size={14} aria-hidden /> {t("Autoalojado y privado")}
          </p>
          <h1 className="max-w-3xl text-4xl font-bold tracking-tight text-balance sm:text-5xl">{t("Tus tareas, tus releases y tu documentación, en tu propio servidor")}</h1>
          <p className="mt-4 max-w-2xl text-lg text-slate-600 dark:text-slate-400">
            {t("Pizarro es un tablero Kanban con notas de release generadas y documentación del proyecto. Lo instalas en tu servidor, tus datos no salen de él y no hay rastreadores ni cuota por usuario.")}
          </p>
          <div className="mt-7 flex flex-wrap gap-3">
            <a href="#demo" className="btn-primary px-5 py-2.5 text-base" data-testid="cta-demo">{t("Probar la demo")} <ArrowRight size={16} aria-hidden /></a>
            <a href="#instalacion" className="btn-secondary px-5 py-2.5 text-base" data-testid="cta-install">{t("Cómo se instala")}</a>
          </div>
          <p className="mt-3 text-sm text-slate-600 dark:text-slate-400">{t("Sin registro ni tarjeta para probarla: la demo funciona en tu navegador.")}</p>
          <ul className="mt-8 flex flex-wrap gap-x-6 gap-y-2 text-sm text-slate-600 dark:text-slate-400">
            {[t("Kanban con arrastrar y soltar"), t("Release notes en un clic"), t("Documentación del proyecto"), t("Sin servicios externos obligatorios")].map((x) => (
              <li key={x} className="inline-flex items-center gap-1.5"><Check size={15} className="text-brand-600 dark:text-brand-300" aria-hidden />{x}</li>
            ))}
          </ul>
        </section>

        <section className="border-t border-slate-200 bg-white py-14 dark:border-slate-800 dark:bg-slate-900/40" aria-labelledby="funciones">
          <div className="mx-auto max-w-6xl px-4">
            <SectionTitle id="funciones" title={t("Todo lo que necesitas, sin complicarte")} lead={t("Un tablero pensado para equipos pequeños, con las piezas que suelen faltar: notas de release, documentación y copias de seguridad que se prueban.")} />
            <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {features.map((f) => (
                <li key={f.title} className="card flex gap-3 p-4">
                  <IconBox icon={f.icon} />
                  <div>
                    <h3 className="font-semibold">{f.title}</h3>
                    <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">{f.text}</p>
                  </div>
                </li>
              ))}
            </ul>

            <h3 className="mt-12 mb-1 text-xl font-bold tracking-tight">{t("Columnas especiales")}</h3>
            <p className="mb-5 max-w-2xl text-slate-600 dark:text-slate-400">{t("Dale un rol a una columna y el tablero hace trabajo extra por ti.")}</p>
            <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {specials.map((f) => (
                <li key={f.title} className="rounded-xl border border-slate-200 p-3.5 dark:border-slate-800">
                  <div className="mb-1.5 flex items-center gap-2">
                    <IconBox icon={f.icon} />
                    <h4 className="text-sm font-semibold">{f.title}</h4>
                  </div>
                  <p className="text-sm text-slate-600 dark:text-slate-400">{f.text}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-4 py-14" aria-labelledby="comparativa">
          <SectionTitle id="comparativa" title={t("Pizarro frente a otras herramientas")} lead={t("Cada herramienta resuelve algo distinto. Esta comparación resume en qué se parecen y en qué no.")} />
          <div className="card overflow-x-auto" tabIndex={0} role="region" aria-label={t("Tabla comparativa")}>
            <table className="w-full min-w-[46rem] border-collapse text-left text-sm" data-testid="comparison">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800">
                  <th scope="col" className="p-3 font-medium text-slate-500"><span className="sr-only">{t("Criterio")}</span></th>
                  {products.map((p, i) => (
                    <th key={p} scope="col" className={`p-3 font-semibold ${i === 0 ? "bg-brand-50 text-brand-700 dark:bg-brand-500/10 dark:text-brand-300" : ""}`}>{p}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.label} className="border-b border-slate-100 last:border-0 dark:border-slate-800/70">
                    <th scope="row" className="w-40 p-3 align-top font-medium">{r.label}</th>
                    {r.cells.map((c, i) => (
                      <td key={i} className={`p-3 align-top text-slate-600 dark:text-slate-400 ${i === 0 ? "bg-brand-50/60 font-medium text-slate-900 dark:bg-brand-500/5 dark:text-slate-100" : ""}`}>{c}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-3 flex items-start gap-1.5 text-xs text-slate-500">
            <Minus size={14} className="mt-0.5 shrink-0" aria-hidden />
            {t("Comparación orientativa según los planes y la documentación públicos de cada producto, que cambian con el tiempo: compruébalo en sus webs antes de decidir. Los nombres pertenecen a sus propietarios y no hay relación con ellos.")}
          </p>
        </section>

        <section className="border-t border-slate-200 bg-white py-14 dark:border-slate-800 dark:bg-slate-900/40" aria-labelledby="para-quien">
          <div className="mx-auto max-w-6xl px-4">
            <SectionTitle id="para-quien" title={t("Para quién es")} lead={t("Se crea un proyecto desde una plantilla de serie (o la tuya) y ya tiene columnas, tipos de tarea y etiquetas.")} />
            <div className="grid gap-4 md:grid-cols-3">
              {audiences.map((a) => (
                <article key={a.title} className="card flex flex-col p-5">
                  <IconBox icon={a.icon} />
                  <h3 className="mt-3 text-lg font-semibold">{a.title}</h3>
                  <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">{a.text}</p>
                  <ul className="mt-3 space-y-1.5 text-sm">
                    {a.examples.map((e) => (
                      <li key={e} className="flex gap-2"><Check size={15} className="mt-0.5 shrink-0 text-brand-600 dark:text-brand-300" aria-hidden />{e}</li>
                    ))}
                  </ul>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-4 py-14" aria-labelledby="demo">
          <SectionTitle id="demo" title={t("Pruébalo")} lead={t("Un proyecto de ejemplo que funciona aquí mismo, sin registrarte. Lo que hagas se queda en tu navegador.")} />
          <LandingDemoLoader />
        </section>

        <section className="border-t border-slate-200 bg-white py-14 dark:border-slate-800 dark:bg-slate-900/40" aria-labelledby="instalacion">
          <div className="mx-auto max-w-6xl px-4">
            <SectionTitle id="instalacion" title={t("Cómo se instala")} lead={t("Tres pasos, sin ser administrador de sistemas.")} />
            <ol className="grid gap-4 md:grid-cols-3" data-testid="install-steps">
              {steps.map((st, i) => (
                <li key={st.title} className="card flex gap-3 p-5">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-600 text-sm font-bold text-on-brand" aria-hidden>{i + 1}</span>
                  <div>
                    <h3 className="font-semibold">{st.title}</h3>
                    <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">{st.text}</p>
                  </div>
                </li>
              ))}
            </ol>
            <p className="mt-5 text-sm text-slate-600 dark:text-slate-400">
              {t("¿Prefieres Railway? Hay una plantilla con la base de datos incluida. Los detalles están en la guía de instalación.")}{" "}
              <a href={INSTALL_URL} rel="noopener noreferrer" className="font-medium text-brand-700 underline dark:text-brand-300">{t("Guía de instalación")}</a>
            </p>
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-4 py-14" aria-labelledby="precios">
          <SectionTitle id="precios" title={t("Precios")} lead={t("Pizarro no cobra por usuario: el coste es el de tu servidor.")} />
          <div className="card max-w-2xl p-5" data-testid="pricing">
            <p className="font-semibold">{t("Precios: próximamente")}</p>
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">{t("Todavía no hay tarifas publicadas. Si quieres saber cuándo las habrá, o instalarla ya, contacta.")}</p>
            {contactEmail && (
              <a href={`mailto:${contactEmail}`} className="btn-primary mt-4 inline-flex" data-testid="pricing-contact"><Mail size={16} aria-hidden />{t("Contacto")}: {contactEmail}</a>
            )}
          </div>
        </section>

        <section className="border-t border-slate-200 bg-white py-14 dark:border-slate-800 dark:bg-slate-900/40" aria-labelledby="preguntas">
          <div className="mx-auto max-w-3xl px-4">
            <SectionTitle id="preguntas" title={t("Preguntas frecuentes")} />
            <div className="space-y-2" data-testid="faq">
              {faq.map((f) => (
                <details key={f.q} className="card group p-4">
                  <summary className="cursor-pointer font-semibold marker:text-brand-600">{f.q}</summary>
                  <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">{f.a}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        <section className="border-t border-slate-200 bg-brand-600 py-12 text-on-brand dark:border-slate-800">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-4 px-4">
            <div className="mr-auto max-w-xl">
              <h2 className="text-2xl font-bold tracking-tight">{t("¿Lo instalas en tu servidor?")}</h2>
              <p className="mt-1 opacity-90">{t("Un contenedor, una base de datos PostgreSQL y una guía paso a paso. También hay una instalación en un solo comando.")}</p>
            </div>
            <a href={INSTALL_URL} rel="noopener noreferrer" className="btn bg-white px-5 py-2.5 text-base text-brand-700 hover:bg-brand-50">{t("Guía de instalación")} <FileDown size={16} aria-hidden /></a>
          </div>
        </section>
      </main>

      <footer className="border-t border-slate-200 py-8 text-sm text-slate-600 dark:border-slate-800 dark:text-slate-400">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-3 px-4">
          <span className="mr-auto inline-flex items-center gap-2 font-semibold text-slate-900 dark:text-slate-100"><BrandMark size={22} /> Pizarro</span>
          <Link href="/privacy" className="hover:underline">{t("Privacidad")}</Link>
          <Link href="/terms" className="hover:underline">{t("Condiciones")}</Link>
          <a href={REPO_URL} rel="noopener noreferrer" className="hover:underline">GitHub</a>
          {contactEmail && <a href={`mailto:${contactEmail}`} className="inline-flex items-center gap-1 hover:underline" data-testid="landing-contact"><Mail size={14} aria-hidden />{t("Contacto")}: {contactEmail}</a>}
        </div>
      </footer>
    </div>
  );
}
