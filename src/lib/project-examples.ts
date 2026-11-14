// Proyectos de ejemplo listos para usar: se eligen al crear un proyecto («Empezar desde un ejemplo»).
// Cada ejemplo es DATOS: una plantilla (columnas con sus roles, tipos, etiquetas, campos y plantillas de release,
// la misma forma que las plantillas de proyecto) más unas pocas tarjetas de muestra y entregables. Se crean con
// la misma lógica que una plantilla (`applyTemplate` en actions/projects.ts); las tarjetas, con
// `project-example-apply.ts`. Para añadir un ejemplo basta con añadir otro elemento a PROJECT_EXAMPLES con sus
// dos versiones (es y en); `tests/project-examples.test.ts` comprueba que sean válidas y que coincidan.
//
// Todas las tarjetas de muestra llevan la etiqueta EXAMPLE_LABEL para poder encontrarlas y borrarlas juntas.
import { builtinByKey, col, kind } from "./builtin-templates";
import { BUILTIN_TEMPLATES_EN } from "./builtin-templates-en";
import { MAX_DESCRIPTION, MAX_TITLE } from "./constants";
import { templateInputSchema, type TemplateData, type TemplateInput } from "./project-templates";
import type { TaskFieldKey } from "./task-fields";

export type ExampleLocale = "es" | "en";

/** Tipos generales de serie que una tarjeta de ejemplo puede usar (se buscan por su id estable). */
export const GENERAL_KIND_IDS = { feature: "kind_funcionalidad", bugfix: "kind_correccion" } as const;
type GeneralKindRef = keyof typeof GENERAL_KIND_IDS;

interface ExampleTask {
  title: string;
  description?: string;
  /** Posición (desde 0) de la columna en `template.columns`. */
  column: number;
  /** Nombre de un tipo propio de la plantilla… */
  kind?: string;
  /** …o un tipo general de serie (exactamente uno de los dos). */
  generalKind?: GeneralKindRef;
  /** Etiquetas de la plantilla además de la de ejemplo, que siempre se añade. */
  labels?: string[];
  subtasks?: string[];
  /** Fecha límite: días desde hoy. */
  dueInDays?: number;
  /** Fecha de inicio: días desde hoy (solo si la plantilla activa el campo «Fecha de inicio»). */
  startInDays?: number;
  /** Posición (desde 0) en `deliverables`. */
  deliverable?: number;
  recurrence?: "DAILY" | "WEEKLY" | "MONTHLY";
  /** Semanal: 1 = lunes … 7 = domingo. Mensual: día del mes. */
  recurrenceDay?: number;
  /** Tarea fija («Siempre en la release» o «Siempre en el plan»): solo en una columna con ese rol. */
  evergreen?: boolean;
  /** Campos opcionales: solo si la plantilla los activa. */
  priority?: "BAJA" | "MEDIA" | "ALTA" | "URGENTE";
  cost?: number;
  estimatedHours?: number;
  client?: string;
}

interface ExampleDeliverable {
  name: string;
  description?: string;
  /** Fecha objetivo: días desde hoy. */
  dueInDays: number;
}

export interface ProjectExampleContent {
  /** Nombre sugerido para el proyecto. */
  name: string;
  /** Una o dos frases para el selector; también es la descripción del proyecto creado. */
  description: string;
  template: TemplateInput;
  deliverables?: ExampleDeliverable[];
  tasks: ExampleTask[];
}

interface ProjectExample {
  /** Identificador estable (lo recibe createProject). */
  key: string;
  es: ProjectExampleContent;
  en: ProjectExampleContent;
}

/** Etiqueta que llevan todas las tarjetas de muestra. */
export const EXAMPLE_LABEL: Record<ExampleLocale, { name: string; color: string }> = {
  es: { name: "Ejemplo", color: "#a855f7" },
  en: { name: "Example", color: "#a855f7" },
};

/** Nombres españoles de los tipos generales de serie (los guardados en la base de datos). */
const HIDE_REPLY = ["Respuesta"];
const ALL_GENERAL = ["Funcionalidad", "Corrección", "Respuesta"];

const WELCOME_ES =
  "Cada columna es una fase del trabajo: **arrastra** las tarjetas de una a otra según avancen.\n\n" +
  "Pulsa una tarjeta para abrirla: allí añades subtareas, comentarios, adjuntos y fechas.\n\n" +
  "Las tarjetas de ejemplo llevan la etiqueta «Ejemplo». Cuando no las necesites, pulsa «Seleccionar», marca las tarjetas y bórralas; o ábrelas y bórralas una a una.";
const WELCOME_EN =
  "Each column is a stage of the work: **drag** cards from one to the next as they progress.\n\n" +
  "Click a card to open it: that is where you add subtasks, comments, attachments and dates.\n\n" +
  "The sample cards carry the “Example” label. When you no longer need them, click “Select”, tick the cards and delete them; or open them and delete them one by one.";

export const PROJECT_EXAMPLES: ProjectExample[] = [
  // --- Equipo de software ---------------------------------------------------------------------------------
  {
    key: "equipo-software",
    es: {
      name: "Equipo de software",
      description: "Ideas, tareas, revisión y releases: del primer apunte a la versión publicada, con notas de versión.",
      template: {
        name: "Equipo de software",
        description: "",
        columns: [
          col("Ideas"),
          col("Por hacer"),
          col("En curso"),
          col("Revisión"),
          col("Siguiente release", false, "NEXT_RELEASE"),
          col("Hecho", true, "IN_PRODUCTION"),
        ],
        // Funcionalidad y Corrección son tipos generales: aquí solo se añade «Mejora».
        kinds: [kind("Mejora", "#0ea5e9", "", "**Qué mejora:**\n\n**Cómo sabremos que está bien:**\n")],
        hiddenGeneralKinds: HIDE_REPLY,
        hideAllGeneralKinds: false,
        labels: [
          { name: "Urgente", color: "#ef4444" },
          { name: "Bloqueado", color: "#f97316" },
        ],
        taskFields: ["priority"],
        releaseTemplates: [
          { kind: "HEADER", name: "Novedades de la versión", content: "## Novedades de esta versión\n\nResumen de lo que cambia para quien usa el producto." },
          { kind: "FOOTER", name: "Contacto de soporte", content: "¿Algo no funciona como esperabas? Escríbenos a soporte@example.com." },
        ],
      },
      tasks: [
        { title: "Bienvenida: así se usa este tablero", description: WELCOME_ES, column: 0, kind: "Mejora" },
        { title: "Idea: modo oscuro para la aplicación", description: "Las ideas empiezan aquí. Cuando se decida hacerlas, arrástralas a «Por hacer».", column: 0, kind: "Mejora" },
        { title: "Corregir el error al guardar el formulario", description: "Los tipos de tarjeta (Funcionalidad, Corrección, Mejora) ordenan las notas de la release.", column: 1, generalKind: "bugfix", priority: "ALTA", labels: ["Urgente"], subtasks: ["Reproducir el error", "Escribir la prueba", "Arreglarlo"] },
        { title: "Añadir inicio de sesión con correo", description: "Las subtareas se marcan desde la tarjeta; la barra de progreso se ve en el tablero.", column: 2, generalKind: "feature", priority: "MEDIA", dueInDays: 5, subtasks: ["Diseñar la pantalla", "Conectar con el servidor", "Probar en el móvil"] },
        { title: "Acelerar la carga de la lista de pedidos", description: "En «Revisión» se espera la aprobación de otra persona antes de entrar en la release.", column: 3, kind: "Mejora" },
        { title: "Texto de ayuda en la página de ajustes", description: "Lo que está en «Siguiente release» sale en las notas al pulsar «Generar release», con las cabeceras y pies del proyecto. Al publicarla, estas tarjetas pasan a «Hecho».", column: 4, kind: "Mejora" },
      ],
    },
    en: {
      name: "Software team",
      description: "Ideas, tasks, review and releases: from the first note to the published version, with release notes.",
      template: {
        name: "Software team",
        description: "",
        columns: [
          col("Ideas"),
          col("To do"),
          col("In progress"),
          col("Review"),
          col("Next release", false, "NEXT_RELEASE"),
          col("Done", true, "IN_PRODUCTION"),
        ],
        kinds: [kind("Improvement", "#0ea5e9", "", "**What it improves:**\n\n**How we will know it works:**\n")],
        hiddenGeneralKinds: HIDE_REPLY,
        hideAllGeneralKinds: false,
        labels: [
          { name: "Urgent", color: "#ef4444" },
          { name: "Blocked", color: "#f97316" },
        ],
        taskFields: ["priority"],
        releaseTemplates: [
          { kind: "HEADER", name: "Release highlights", content: "## What is new in this version\n\nA summary of what changes for the people who use the product." },
          { kind: "FOOTER", name: "Support contact", content: "Something does not work as you expected? Write to us at support@example.com." },
        ],
      },
      tasks: [
        { title: "Welcome: how this board works", description: WELCOME_EN, column: 0, kind: "Improvement" },
        { title: "Idea: dark mode for the app", description: "Ideas start here. Once you decide to build them, drag them to “To do”.", column: 0, kind: "Improvement" },
        { title: "Fix the error when saving the form", description: "Card types (Feature, Bug fix, Improvement) organise the release notes.", column: 1, generalKind: "bugfix", priority: "ALTA", labels: ["Urgent"], subtasks: ["Reproduce the error", "Write the test", "Fix it"] },
        { title: "Add sign-in with email", description: "Subtasks are ticked from the card; the progress bar shows on the board.", column: 2, generalKind: "feature", priority: "MEDIA", dueInDays: 5, subtasks: ["Design the screen", "Connect to the server", "Try it on a phone"] },
        { title: "Speed up loading the order list", description: "“Review” waits for someone else's approval before the card goes into the release.", column: 3, kind: "Improvement" },
        { title: "Help text on the settings page", description: "Whatever is in “Next release” appears in the notes when you click “Generate release”, with the project's headers and footers. Once published, these cards move to “Done”.", column: 4, kind: "Improvement" },
      ],
    },
  },

  // --- Familia / casa -------------------------------------------------------------------------------------
  {
    key: "familia-casa",
    es: {
      name: "Familia y casa",
      description: "Compras, tareas de casa y citas en un solo sitio, con tareas que se repiten solas cada semana.",
      template: {
        name: "Familia y casa",
        description: "",
        columns: [
          col("Por hacer"),
          col("Compras", false, "CHECKLIST"),
          col("Citas", false, "AGENDA"),
          col("Rutinas de la semana", false, "ROUTINES"),
          col("Hecho", true),
        ],
        kinds: [
          kind("Casa", "#f97316", "", "**Qué hay que hacer:**\n"),
          kind("Compras", "#22c55e", "Comprar ", ""),
          kind("Cita", "#ec4899", "Cita: ", "**Dónde y cuándo:**\n"),
        ],
        hiddenGeneralKinds: ALL_GENERAL,
        hideAllGeneralKinds: true,
        labels: [{ name: "Urgente", color: "#ef4444" }],
        taskFields: [],
      },
      tasks: [
        { title: "Bienvenida: así se usa este tablero", description: WELCOME_ES, column: 0, kind: "Casa" },
        { title: "Arreglar el grifo de la cocina", description: "Las tareas puntuales de casa van en «Por hacer» y pasan a «Hecho» al terminarlas.", column: 0, kind: "Casa", labels: ["Urgente"] },
        { title: "Lista de la compra", description: "La columna «Compras» reúne las subtareas de todas sus tarjetas en una lista única que puedes abrir o imprimir (menú de la columna).", column: 1, kind: "Compras", subtasks: ["Leche", "Pan", "Fruta", "Detergente"] },
        { title: "Revisión del dentista", description: "En «Citas», las tarjetas con fecha forman una agenda que se puede añadir al calendario del móvil.", column: 2, kind: "Cita", dueInDays: 7 },
        { title: "Sacar la basura", description: "Las tarjetas de «Rutinas de la semana» se repiten solas: al pasarlas a «Hecho» aparece la siguiente.", column: 3, kind: "Casa", recurrence: "WEEKLY", recurrenceDay: 2 },
        { title: "Limpieza a fondo", description: "Repetición semanal, los sábados.", column: 3, kind: "Casa", recurrence: "WEEKLY", recurrenceDay: 6 },
      ],
    },
    en: {
      name: "Family and home",
      description: "Shopping, household chores and appointments in one place, with tasks that repeat on their own every week.",
      template: {
        name: "Family and home",
        description: "",
        columns: [
          col("To do"),
          col("Shopping", false, "CHECKLIST"),
          col("Appointments", false, "AGENDA"),
          col("Weekly routines", false, "ROUTINES"),
          col("Done", true),
        ],
        kinds: [
          kind("Home", "#f97316", "", "**What needs doing:**\n"),
          kind("Shopping", "#22c55e", "Buy ", ""),
          kind("Appointment", "#ec4899", "Appointment: ", "**Where and when:**\n"),
        ],
        hiddenGeneralKinds: ALL_GENERAL,
        hideAllGeneralKinds: true,
        labels: [{ name: "Urgent", color: "#ef4444" }],
        taskFields: [],
      },
      tasks: [
        { title: "Welcome: how this board works", description: WELCOME_EN, column: 0, kind: "Home" },
        { title: "Fix the kitchen tap", description: "One-off chores go in “To do” and move to “Done” when finished.", column: 0, kind: "Home", labels: ["Urgent"] },
        { title: "Shopping list", description: "The “Shopping” column gathers the subtasks of all its cards into a single list you can open or print (column menu).", column: 1, kind: "Shopping", subtasks: ["Milk", "Bread", "Fruit", "Detergent"] },
        { title: "Dentist check-up", description: "In “Appointments”, cards with a date form an agenda you can add to your phone's calendar.", column: 2, kind: "Appointment", dueInDays: 7 },
        { title: "Take out the rubbish", description: "Cards in “Weekly routines” repeat on their own: move one to “Done” and the next one appears.", column: 3, kind: "Home", recurrence: "WEEKLY", recurrenceDay: 2 },
        { title: "Deep clean", description: "Repeats weekly, on Saturdays.", column: 3, kind: "Home", recurrence: "WEEKLY", recurrenceDay: 6 },
      ],
    },
  },

  // --- Eventos --------------------------------------------------------------------------------------------
  {
    key: "eventos",
    es: {
      name: "Preparación de un evento",
      description: "Del primer boceto al día del evento: fechas límite, entregables en el calendario, proveedores y presupuesto.",
      template: {
        name: "Preparación de un evento",
        description: "",
        columns: [
          col("Ideas"),
          col("Esperando respuesta", false, "WAITING"),
          col("En preparación"),
          col("Presupuesto", false, "BUDGET"),
          col("Hecho", true),
        ],
        kinds: [
          kind("Lugar", "#0ea5e9", "Lugar: ", "**Opciones:**\n\n**Aforo y precio:**\n"),
          kind("Proveedor", "#f97316", "Proveedor: ", "**Servicio:**\n\n**Contacto:**\n"),
          kind("Invitados", "#ec4899", "", "**Lista y número de personas:**\n"),
          kind("Logística", "#6366f1", "", "**Qué hay que preparar y cuándo:**\n"),
        ],
        hiddenGeneralKinds: ALL_GENERAL,
        hideAllGeneralKinds: true,
        labels: [
          { name: "Urgente", color: "#ef4444" },
          { name: "Día del evento", color: "#22c55e" },
        ],
        taskFields: [],
      },
      deliverables: [
        { name: "Lugar reservado", description: "Sala elegida y señal pagada.", dueInDays: 14 },
        { name: "Invitaciones enviadas", dueInDays: 28 },
        { name: "Día del evento", dueInDays: 60 },
      ],
      tasks: [
        { title: "Bienvenida: así se usa este tablero", description: WELCOME_ES + "\n\nLos **entregables** (hitos con fecha) se ven en el calendario del proyecto y se asignan a cada tarjeta.", column: 0, kind: "Logística" },
        { title: "Elegir el lugar", description: "Está vinculada al entregable «Lugar reservado», que aparece en el calendario.", column: 2, kind: "Lugar", deliverable: 0, dueInDays: 10, subtasks: ["Visitar dos salas", "Comparar condiciones", "Reservar"] },
        { title: "Pedir presupuesto de catering", description: "En «Esperando respuesta» una tarjeta avisa a su responsable si lleva varios días sin moverse.", column: 1, kind: "Proveedor", labels: ["Urgente"] },
        { title: "Enviar las invitaciones", description: "Cada tarjeta puede tener fecha límite y entregable.", column: 2, kind: "Invitados", deliverable: 1, dueInDays: 28, subtasks: ["Cerrar la lista", "Enviar el correo", "Confirmar asistencia"] },
        { title: "Alquiler de sonido", description: "En la columna «Presupuesto» se suma el coste de sus tarjetas.", column: 3, kind: "Proveedor", cost: 450 },
        { title: "Montaje de la sala", description: "Plan del día del evento.", column: 2, kind: "Logística", deliverable: 2, dueInDays: 60, labels: ["Día del evento"] },
      ],
    },
    en: {
      name: "Event planning",
      description: "From the first sketch to the day itself: deadlines, deliverables on the calendar, suppliers and budget.",
      template: {
        name: "Event planning",
        description: "",
        columns: [
          col("Ideas"),
          col("Waiting for a reply", false, "WAITING"),
          col("In preparation"),
          col("Budget", false, "BUDGET"),
          col("Done", true),
        ],
        kinds: [
          kind("Venue", "#0ea5e9", "Venue: ", "**Options:**\n\n**Capacity and price:**\n"),
          kind("Supplier", "#f97316", "Supplier: ", "**Service:**\n\n**Contact:**\n"),
          kind("Guests", "#ec4899", "", "**List and number of people:**\n"),
          kind("Logistics", "#6366f1", "", "**What to prepare and when:**\n"),
        ],
        hiddenGeneralKinds: ALL_GENERAL,
        hideAllGeneralKinds: true,
        labels: [
          { name: "Urgent", color: "#ef4444" },
          { name: "Event day", color: "#22c55e" },
        ],
        taskFields: [],
      },
      deliverables: [
        { name: "Venue booked", description: "Room chosen and deposit paid.", dueInDays: 14 },
        { name: "Invitations sent", dueInDays: 28 },
        { name: "Event day", dueInDays: 60 },
      ],
      tasks: [
        { title: "Welcome: how this board works", description: WELCOME_EN + "\n\n**Deliverables** (milestones with a date) show on the project calendar and are assigned to each card.", column: 0, kind: "Logistics" },
        { title: "Choose the venue", description: "Linked to the “Venue booked” deliverable, which shows on the calendar.", column: 2, kind: "Venue", deliverable: 0, dueInDays: 10, subtasks: ["Visit two rooms", "Compare terms", "Book it"] },
        { title: "Ask for a catering quote", description: "In “Waiting for a reply”, a card reminds its owner if it has not moved for a few days.", column: 1, kind: "Supplier", labels: ["Urgent"] },
        { title: "Send the invitations", description: "Every card can have a due date and a deliverable.", column: 2, kind: "Guests", deliverable: 1, dueInDays: 28, subtasks: ["Close the list", "Send the email", "Confirm attendance"] },
        { title: "Sound equipment hire", description: "The “Budget” column adds up the cost of its cards.", column: 3, kind: "Supplier", cost: 450 },
        { title: "Set up the room", description: "Plan for the day of the event.", column: 2, kind: "Logistics", deliverable: 2, dueInDays: 60, labels: ["Event day"] },
      ],
    },
  },

  // --- Empresa / clientes ---------------------------------------------------------------------------------
  {
    key: "empresa-clientes",
    es: {
      name: "Empresa y clientes",
      description: "Seguimiento de encargos de clientes: presupuesto, trabajo, entrega y cobro.",
      template: {
        name: "Empresa y clientes",
        description: "",
        columns: [
          col("Presupuestos", false, "BUDGET"),
          col("En curso"),
          col("Esperando al cliente", false, "WAITING"),
          col("Entrega al cliente", false, "DELIVERY"),
          col("Cobrado", true),
        ],
        kinds: [
          kind("Encargo", "#6366f1", "", "**Qué pide el cliente:**\n\n**Plazo acordado:**\n"),
          kind("Reunión", "#a855f7", "Reunión: ", "**Temas:**\n\n**Acuerdos:**\n"),
          kind("Cobro", "#eab308", "Cobro: ", "**Factura y vencimiento:**\n"),
        ],
        hiddenGeneralKinds: ALL_GENERAL,
        hideAllGeneralKinds: true,
        labels: [
          { name: "Urgente", color: "#ef4444" },
          { name: "Cliente importante", color: "#22c55e" },
        ],
        taskFields: ["client", "priority", "hours"],
      },
      tasks: [
        { title: "Bienvenida: así se usa este tablero", description: WELCOME_ES + "\n\nActiva en los ajustes del proyecto los campos que necesites (cliente, prioridad, horas, coste).", column: 1, kind: "Encargo" },
        { title: "Presupuesto de rediseño de la tienda", description: "En «Presupuestos» se suma el coste de las tarjetas. Si el cliente acepta, arrástrala a «En curso».", column: 0, kind: "Encargo", client: "Cliente A", cost: 1800, estimatedHours: 30 },
        { title: "Diseño del catálogo", description: "El campo «Cliente» permite filtrar y agrupar los encargos por cliente.", column: 1, kind: "Encargo", client: "Cliente B", priority: "ALTA", estimatedHours: 12, dueInDays: 6, subtasks: ["Primer borrador", "Revisar con el cliente", "Versión final"] },
        { title: "Esperando la aprobación del logotipo", description: "En «Esperando al cliente» la tarjeta avisa a quien la lleva si pasan varios días sin respuesta.", column: 2, kind: "Encargo", client: "Cliente A", labels: ["Cliente importante"] },
        { title: "Entrega de la web de Cliente C", description: "La columna «Entrega al cliente» genera un resumen en PDF sin comentarios ni nombres de personas, listo para enviar.", column: 3, kind: "Encargo", client: "Cliente C" },
        { title: "Cobrar la factura de marzo", description: "Cuando se cobra, la tarjeta pasa a «Cobrado».", column: 4, kind: "Cobro", client: "Cliente B", cost: 950 },
      ],
    },
    en: {
      name: "Business and clients",
      description: "Tracking client work: quote, work, delivery and payment.",
      template: {
        name: "Business and clients",
        description: "",
        columns: [
          col("Quotes", false, "BUDGET"),
          col("In progress"),
          col("Waiting for the client", false, "WAITING"),
          col("Client delivery", false, "DELIVERY"),
          col("Paid", true),
        ],
        kinds: [
          kind("Job", "#6366f1", "", "**What the client asks for:**\n\n**Agreed deadline:**\n"),
          kind("Meeting", "#a855f7", "Meeting: ", "**Topics:**\n\n**Agreements:**\n"),
          kind("Payment", "#eab308", "Payment: ", "**Invoice and due date:**\n"),
        ],
        hiddenGeneralKinds: ALL_GENERAL,
        hideAllGeneralKinds: true,
        labels: [
          { name: "Urgent", color: "#ef4444" },
          { name: "Key client", color: "#22c55e" },
        ],
        taskFields: ["client", "priority", "hours"],
      },
      tasks: [
        { title: "Welcome: how this board works", description: WELCOME_EN + "\n\nTurn on the fields you need in the project settings (client, priority, hours, cost).", column: 1, kind: "Job" },
        { title: "Quote for the shop redesign", description: "“Quotes” adds up the cost of its cards. If the client accepts, drag it to “In progress”.", column: 0, kind: "Job", client: "Client A", cost: 1800, estimatedHours: 30 },
        { title: "Catalogue design", description: "The “Client” field lets you filter and group jobs by client.", column: 1, kind: "Job", client: "Client B", priority: "ALTA", estimatedHours: 12, dueInDays: 6, subtasks: ["First draft", "Review with the client", "Final version"] },
        { title: "Waiting for logo approval", description: "In “Waiting for the client”, the card reminds its owner if several days pass without a reply.", column: 2, kind: "Job", client: "Client A", labels: ["Key client"] },
        { title: "Delivery of Client C's website", description: "The “Client delivery” column generates a PDF summary with no comments or people's names, ready to send.", column: 3, kind: "Job", client: "Client C" },
        { title: "Collect the March invoice", description: "When it is paid, the card moves to “Paid”.", column: 4, kind: "Payment", client: "Client B", cost: 950 },
      ],
    },
  },

  // --- Preparación de un curso -----------------------------------------------------------------------------
  // La misma estructura que la plantilla de serie «Curso o máster», con sesiones de muestra en «Programa». Con otro
  // nombre: en «Nuevo proyecto» un ejemplo y una plantilla no deben llamarse igual.
  {
    key: "curso-master",
    es: {
      name: "Preparación de un curso",
      description: "Preparar un curso con un agente de IA: los encargos para el agente en «Plan de trabajo para IA», una tarjeta por sesión en «Programa» (que se publica en PDF), materiales, ejercicios y exámenes, y seguimiento de alumnos.",
      template: { ...builtinByKey("curso-master")!.data, description: "" },
      tasks: [
        {
          title: "Bienvenida: así se usa este tablero",
          description:
            WELCOME_ES +
            "\n\nEn **Programa** cada tarjeta es una sesión del curso, con su fecha. «Publicar programa (PDF)» genera el programa con las sesiones en ese orden y guarda una copia en Documentación.\n\n" +
            "Al elegir un tipo (Preparar material, Preparar ejercicio, Preparar examen…) la descripción se rellena con un encargo para un agente de IA: objetivo, contenido, formato de entrega, duración, criterios y notas para el agente.\n\n" +
            "Lleva a **Plan de trabajo para IA** los encargos que quieras darle al agente y pulsa «Generar plan de trabajo»: sale un texto en Markdown con las instrucciones y cada tarea, listo para copiarlo en Claude Code o guardarlo en Documentación. Las de «Siempre en el plan» entran en todos.",
          column: 0,
          kind: "Preparar material",
        },
        {
          title: "Sesión: Presentación del curso",
          description: "**Objetivos:** conocer el curso, el calendario y la forma de evaluación.\n\n**Contenidos:**\n\n- Presentación de profesores y alumnos\n- Programa y calendario\n- Criterios de evaluación\n\n**Actividades:** ronda de presentaciones.\n\n**Lecturas y materiales:** guía del curso.",
          column: 4, kind: "Sesión", labels: ["Módulo 1"], dueInDays: 14,
        },
        {
          title: "Sesión: Fundamentos",
          description: "**Objetivos:** dominar los conceptos básicos del módulo 1.\n\n**Contenidos:**\n\n- Conceptos clave\n- Ejemplos resueltos\n\n**Actividades:** ejercicio en parejas.",
          column: 4, kind: "Sesión", labels: ["Módulo 1"], dueInDays: 21,
        },
        {
          title: "Sesión: Taller práctico",
          description: "**Objetivos:** aplicar lo aprendido en un caso real.\n\n**Actividades:** taller de tres días con entrega final.",
          column: 4, kind: "Sesión", labels: ["Módulo 2"], startInDays: 26, dueInDays: 28,
        },
        {
          title: "Material: Diapositivas de fundamentos",
          description: "**Objetivo:** diapositivas para la sesión «Fundamentos».\n\n**Contenido:**\n\n- Conceptos clave con un ejemplo cada uno\n\n**Formato de entrega:** Google Slides\n\n**Duración o extensión:** unas 20 diapositivas\n\n**Notas para el agente:** lenguaje sencillo; una idea por diapositiva.",
          column: 1, kind: "Preparar material", labels: ["Módulo 1", "Para el agente"], dueInDays: 18, subtasks: ["Encargar el borrador al agente", "Revisar y corregir", "Publicar para los alumnos"],
        },
        {
          title: "Examen: Parcial del módulo 1",
          description: "La etiqueta «Revisión de coordinación» indica que otro profesor o la coordinación debe dar el visto bueno.",
          column: 2, kind: "Preparar examen", labels: ["Módulo 1", "Revisión de coordinación"], dueInDays: 35, subtasks: ["Preparar las preguntas", "Preparar la plantilla de corrección"],
        },
        {
          title: "Ejercicio: Casos prácticos del módulo 1",
          description: "**Objetivo:** practicar los conceptos clave del módulo 1.\n\n**Enunciado o tema:** tres casos cortos, de menos a más difícil.\n\n**Formato de entrega:** Markdown\n\n**Duración estimada:** 45 minutos\n\n**Criterios de corrección:** se aplica el concepto correcto y se justifica la respuesta.\n\n**Notas para el agente:** prepara también la solución.",
          column: 3, kind: "Preparar ejercicio", labels: ["Módulo 1", "Para el agente"], dueInDays: 20, subtasks: ["Redactar el enunciado", "Preparar la solución", "Probar la dificultad"],
        },
        {
          title: "Material: Revisar el estilo de lo entregado",
          description: "Tarea fija del plan: entra en todos los planes de trabajo.\n\n**Objetivo:** que todo lo que prepare el agente siga el mismo estilo.\n\n**Notas para el agente:** lenguaje claro, sin erratas, títulos homogéneos y la misma plantilla en todos los documentos.",
          column: 3, kind: "Preparar material", labels: ["Para el agente"], evergreen: true,
        },
        {
          title: "Perfil: alumno A",
          description: "Revisar el perfil de un alumno es una tarea del profesor. Usa una referencia en vez de datos personales si el proyecto lo comparte más gente.",
          column: 5, kind: "Revisar perfil de alumno",
        },
      ],
    },
    en: {
      name: "Course preparation",
      description: "Prepare a course with an AI agent: the briefs for the agent in “AI work plan”, one card per session in “Programme” (published as a PDF), materials, exercises and exams, and student follow-up.",
      template: { ...BUILTIN_TEMPLATES_EN["curso-master"]!, description: "" },
      tasks: [
        {
          title: "Welcome: how this board works",
          description:
            WELCOME_EN +
            "\n\nIn **Programme** each card is a session of the course, with its date. “Publish programme (PDF)” generates the programme with the sessions in that order and saves a copy in Documentation.\n\n" +
            "When you choose a type (Prepare material, Prepare exercise, Prepare exam…) the description is filled in with a brief for an AI agent: objective, content, delivery format, duration, criteria and notes for the agent.\n\n" +
            "Move the briefs you want to give the agent to **AI work plan** and click “Generate work plan”: you get a Markdown text with the instructions and every task, ready to paste into Claude Code or save in Documentation. Those under “Always in the plan” go into every plan.",
          column: 0,
          kind: "Prepare material",
        },
        {
          title: "Session: Course introduction",
          description: "**Objectives:** get to know the course, the calendar and how it is assessed.\n\n**Topics:**\n\n- Teachers and students introduce themselves\n- Programme and calendar\n- Assessment criteria\n\n**Activities:** round of introductions.\n\n**Readings and materials:** course guide.",
          column: 4, kind: "Session", labels: ["Module 1"], dueInDays: 14,
        },
        {
          title: "Session: Fundamentals",
          description: "**Objectives:** master the basic concepts of module 1.\n\n**Topics:**\n\n- Key concepts\n- Worked examples\n\n**Activities:** pair exercise.",
          column: 4, kind: "Session", labels: ["Module 1"], dueInDays: 21,
        },
        {
          title: "Session: Hands-on workshop",
          description: "**Objectives:** apply what was learned to a real case.\n\n**Activities:** three-day workshop ending in a final submission.",
          column: 4, kind: "Session", labels: ["Module 2"], startInDays: 26, dueInDays: 28,
        },
        {
          title: "Material: Fundamentals slides",
          description: "**Objective:** slides for the “Fundamentals” session.\n\n**Content:**\n\n- Key concepts, each one with an example\n\n**Delivery format:** Google Slides\n\n**Length or duration:** about 20 slides\n\n**Notes for the agent:** plain language; one idea per slide.",
          column: 1, kind: "Prepare material", labels: ["Module 1", "For the agent"], dueInDays: 18, subtasks: ["Ask the agent for a draft", "Review and correct it", "Publish it to students"],
        },
        {
          title: "Exam: Module 1 mid-term",
          description: "The “Coordination review” label means another teacher or the coordinators must approve it.",
          column: 2, kind: "Prepare exam", labels: ["Module 1", "Coordination review"], dueInDays: 35, subtasks: ["Prepare the questions", "Prepare the marking scheme"],
        },
        {
          title: "Exercise: Module 1 case studies",
          description: "**Objective:** practise the key concepts of module 1.\n\n**Task or topic:** three short cases, from easier to harder.\n\n**Delivery format:** Markdown\n\n**Estimated time:** 45 minutes\n\n**Marking criteria:** the right concept is applied and the answer is justified.\n\n**Notes for the agent:** also prepare the solution.",
          column: 3, kind: "Prepare exercise", labels: ["Module 1", "For the agent"], dueInDays: 20, subtasks: ["Write the task", "Prepare the solution", "Check the difficulty"],
        },
        {
          title: "Material: Review the style of the deliverables",
          description: "A fixed task of the plan: it goes into every work plan.\n\n**Objective:** everything the agent prepares follows the same style.\n\n**Notes for the agent:** plain language, no typos, consistent headings and the same template in every document.",
          column: 3, kind: "Prepare material", labels: ["For the agent"], evergreen: true,
        },
        {
          title: "Profile: student A",
          description: "Reviewing a student's profile is a task for the teacher. Use a reference instead of personal data if more people share the project.",
          column: 5, kind: "Review student profile",
        },
      ],
    },
  },
];

export const EXAMPLE_KEYS = PROJECT_EXAMPLES.map((e) => e.key);

function exampleByKey(key: string | null | undefined): ProjectExample | undefined {
  return key ? PROJECT_EXAMPLES.find((e) => e.key === key) : undefined;
}

export interface ResolvedExample {
  key: string;
  content: ProjectExampleContent;
  /** Plantilla validada, lista para `applyTemplate`. */
  template: TemplateData;
  /** Etiqueta de las tarjetas de muestra, ya añadida a `template.labels`. */
  exampleLabel: string;
}

/** El ejemplo en el idioma dado, con su plantilla validada y la etiqueta «Ejemplo» añadida. Null si la clave no existe. */
export function resolveExample(key: string, locale: ExampleLocale): ResolvedExample | null {
  const example = exampleByKey(key);
  if (!example) return null;
  const content = example[locale];
  const label = EXAMPLE_LABEL[locale];
  const template = templateInputSchema.parse({
    ...content.template,
    description: content.description,
    labels: [...(content.template.labels ?? []), label],
  });
  return { key, content, template, exampleLabel: label.name };
}

/** Lista para el selector de «Nuevo proyecto». */
export function listExamples(locale: ExampleLocale): { key: string; name: string; description: string }[] {
  return PROJECT_EXAMPLES.map((e) => ({ key: e.key, name: e[locale].name, description: e[locale].description }));
}

const FIELD_OF_TASK: Record<string, TaskFieldKey> = { priority: "priority", cost: "cost", estimatedHours: "hours", client: "client", startInDays: "startDate" };

/** Errores de coherencia de un ejemplo (vacío = válido): lo usan las pruebas y evita que una errata llegue a producción. */
export function validateExample(content: ProjectExampleContent): string[] {
  const errors: string[] = [];
  const t = templateInputSchema.safeParse(content.template);
  if (!t.success) return [`plantilla no válida: ${t.error.issues.map((i) => i.message).join("; ")}`];
  const tpl = t.data;
  const kindNames = new Set(tpl.kinds.map((k) => k.name.toLowerCase()));
  const labelNames = new Set(tpl.labels.map((l) => l.name.toLowerCase()));
  const deliverables = content.deliverables ?? [];
  if (!content.tasks.length) errors.push("sin tarjetas de muestra");
  if (content.tasks.length > 10) errors.push("demasiadas tarjetas de muestra (máximo 10)");
  if (content.description.length > 2000) errors.push("descripción demasiado larga");
  content.tasks.forEach((task, i) => {
    const at = `tarjeta ${i + 1} («${task.title}»)`;
    if (!task.title.trim() || task.title.length > MAX_TITLE) errors.push(`${at}: título vacío o demasiado largo`);
    if ((task.description ?? "").length > MAX_DESCRIPTION) errors.push(`${at}: descripción demasiado larga`);
    if (!Number.isInteger(task.column) || task.column < 0 || task.column >= tpl.columns.length) errors.push(`${at}: columna fuera de rango`);
    if (!!task.kind === !!task.generalKind) errors.push(`${at}: indica exactamente un tipo (kind o generalKind)`);
    if (task.kind && !kindNames.has(task.kind.toLowerCase())) errors.push(`${at}: el tipo «${task.kind}» no está en la plantilla`);
    if (task.generalKind && !(task.generalKind in GENERAL_KIND_IDS)) errors.push(`${at}: tipo general desconocido`);
    for (const l of task.labels ?? []) if (!labelNames.has(l.toLowerCase())) errors.push(`${at}: la etiqueta «${l}» no está en la plantilla`);
    if (task.deliverable !== undefined && !deliverables[task.deliverable]) errors.push(`${at}: entregable fuera de rango`);
    for (const [prop, field] of Object.entries(FIELD_OF_TASK)) {
      if ((task as unknown as Record<string, unknown>)[prop] !== undefined && !tpl.taskFields.includes(field)) errors.push(`${at}: usa «${prop}» pero la plantilla no activa el campo «${field}»`);
    }
    if (task.recurrenceDay !== undefined && !task.recurrence) errors.push(`${at}: día de repetición sin repetición`);
    if (task.startInDays !== undefined && task.dueInDays !== undefined && task.startInDays > task.dueInDays) errors.push(`${at}: la fecha de inicio es posterior a la fecha límite`);
  });
  if (deliverables.some((d) => !d.name.trim() || d.name.length > 120)) errors.push("entregable con nombre vacío o demasiado largo");
  return errors;
}
