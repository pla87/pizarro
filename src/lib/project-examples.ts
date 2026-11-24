// Tarjetas de ejemplo de las plantillas de serie: en «Nuevo proyecto», al elegir una plantilla de serie, la casilla
// «Con tarjetas de ejemplo» crea además estas pocas tarjetas (y entregables) que enseñan a usar el tablero. Son DATOS:
// cada tarjeta indica su columna por posición en la plantilla canónica (`builtin-templates.ts`, o la inglesa) y su tipo
// y sus etiquetas por nombre; `project-example-apply.ts` las crea buscando esos nombres en el proyecto, así que también
// funcionan (lo mejor posible) con una plantilla de serie que el administrador haya modificado. Cada plantilla lleva
// sus dos versiones (es y en); `tests/project-examples.test.ts` comprueba que sean válidas y que coincidan.
//
// Todas las tarjetas de muestra llevan la etiqueta EXAMPLE_LABEL para poder encontrarlas y borrarlas juntas.
import { canonicalTemplate } from "./builtin-templates";
import { canonicalTemplateEn } from "./builtin-templates-en";
import { MAX_DESCRIPTION, MAX_LABELS_PER_PROJECT, MAX_TITLE } from "./constants";
import type { TemplateData } from "./project-templates";
import type { TaskFieldKey } from "./task-fields";

export type ExampleLocale = "es" | "en";

/** Tipos generales de serie que una tarjeta de ejemplo puede usar (se buscan por su id estable). */
export const GENERAL_KIND_IDS = { feature: "kind_funcionalidad", bugfix: "kind_correccion" } as const;
type GeneralKindRef = keyof typeof GENERAL_KIND_IDS;

interface ExampleTask {
  title: string;
  description?: string;
  /** Posición (desde 0) de la columna en la plantilla canónica. */
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

interface ExampleContent {
  deliverables?: ExampleDeliverable[];
  tasks: ExampleTask[];
}

interface BuiltinExamples {
  /** Clave de la plantilla de serie (`builtinKey`). */
  key: string;
  es: ExampleContent;
  en: ExampleContent;
}

/** Etiqueta que llevan todas las tarjetas de muestra. */
export const EXAMPLE_LABEL: Record<ExampleLocale, TemplateData["labels"][number]> = {
  es: { name: "Ejemplo", color: "#a855f7" },
  en: { name: "Example", color: "#a855f7" },
};

const WELCOME_ES =
  "Cada columna es una fase del trabajo: **arrastra** las tarjetas de una a otra según avancen.\n\n" +
  "Pulsa una tarjeta para abrirla: allí añades subtareas, comentarios, adjuntos y fechas.\n\n" +
  "Las tarjetas de ejemplo llevan la etiqueta «Ejemplo». Cuando no las necesites, marca la casilla de cada una (arriba a la izquierda de la tarjeta) o la de la cabecera de la columna y pulsa «Borrar» en la barra que aparece abajo; o ábrelas y bórralas una a una.";
const WELCOME_EN =
  "Each column is a stage of the work: **drag** cards from one to the next as they progress.\n\n" +
  "Click a card to open it: that is where you add subtasks, comments, attachments and dates.\n\n" +
  "The sample cards carry the “Example” label. When you no longer need them, check the box on each card (top left) or the one in the column header and click “Delete” in the bar that appears at the bottom; or open them and delete them one by one.";

export const PROJECT_EXAMPLES: BuiltinExamples[] = [
  // --- Vibecoding -----------------------------------------------------------------------------------------------
  // Columnas: 0 Ideas, 1 Backlog, 2 En curso con la IA, 3 Revisar y probar, 4 Siguiente release, 5 En producción.
  {
    key: "vibecoding",
    es: {
      tasks: [
        { title: "Bienvenida: así se usa este tablero", description: WELCOME_ES, column: 0, kind: "Mejora" },
        { title: "Idea: modo oscuro para la aplicación", description: "Las ideas empiezan aquí. Cuando decidas hacerlas, arrástralas a «Backlog».", column: 0, kind: "Mejora" },
        { title: "Corregir el error al guardar el formulario", description: "Los tipos de tarjeta (Funcionalidad, Corrección, Mejora) ordenan las notas de la release.", column: 1, generalKind: "bugfix", labels: ["Frontend"], subtasks: ["El formulario se guarda sin errores", "Hay una prueba que reproduce el error", "La prueba pasa"] },
        { title: "Añadir inicio de sesión con correo", description: "Las subtareas se marcan desde la tarjeta; la barra de progreso se ve en el tablero.", column: 2, generalKind: "feature", labels: ["Backend"], dueInDays: 5, subtasks: ["Se puede entrar con el correo", "Hay una prueba que lo cubre", "Funciona en el móvil"] },
        { title: "Acelerar la carga de la lista de pedidos", description: "En «Revisar y probar» se comprueba lo que ha hecho la IA antes de que entre en la release.", column: 3, kind: "Mejora", labels: ["Necesita revisión"] },
        { title: "Texto de ayuda en la página de ajustes", description: "Lo que está en «Siguiente release» sale en las notas al pulsar «Generar release». Al publicarla, estas tarjetas pasan a «En producción».", column: 4, kind: "Mejora" },
      ],
    },
    en: {
      tasks: [
        { title: "Welcome: how this board works", description: WELCOME_EN, column: 0, kind: "Improvement" },
        { title: "Idea: dark mode for the app", description: "Ideas start here. Once you decide to build them, drag them to “Backlog”.", column: 0, kind: "Improvement" },
        { title: "Fix the error when saving the form", description: "Card types (Feature, Bug fix, Improvement) organize the release notes.", column: 1, generalKind: "bugfix", labels: ["Frontend"], subtasks: ["The form saves without errors", "A test reproduces the error", "The test passes"] },
        { title: "Add sign-in with email", description: "Subtasks are checked off from the card; the progress bar shows on the board.", column: 2, generalKind: "feature", labels: ["Backend"], dueInDays: 5, subtasks: ["Signing in with email works", "A test covers it", "Works on a phone"] },
        { title: "Speed up loading the order list", description: "“Review and test” is where you check what the AI did before it goes into the release.", column: 3, kind: "Improvement", labels: ["Needs review"] },
        { title: "Help text on the settings page", description: "Whatever is in “Next release” appears in the notes when you click “Generate release”. Once published, these cards move to “In production”.", column: 4, kind: "Improvement" },
      ],
    },
  },

  // --- Trabajo y clientes ---------------------------------------------------------------------------------------
  // Columnas: 0 Pendiente, 1 En curso, 2 Esperando, 3 Revisión, 4 Tareas periódicas, 5 Hecho.
  {
    key: "trabajo-clientes",
    es: {
      tasks: [
        { title: "Bienvenida: así se usa este tablero", description: WELCOME_ES + "\n\nCliente, prioridad y coste son campos de la tarjeta: permiten filtrar y agrupar. En los ajustes del proyecto puedes activar otros (horas, fecha de inicio).", column: 0, kind: "Encargo" },
        { title: "Presupuesto de rediseño de la tienda", description: "El coste queda en la tarjeta. Si el cliente acepta, arrástrala a «En curso».", column: 0, kind: "Propuesta o presupuesto", client: "Cliente A", cost: 1800 },
        { title: "Diseño del catálogo", description: "El campo «Cliente» permite filtrar y agrupar los encargos por cliente.", column: 1, kind: "Encargo", client: "Cliente B", priority: "ALTA", dueInDays: 6, subtasks: ["Primer borrador", "Revisar con el cliente", "Versión final"] },
        { title: "Esperando la aprobación del logotipo", description: "En «Esperando» la tarjeta avisa a su responsable (o, sin él, a quien la creó) si pasan varios días sin respuesta.", column: 2, kind: "Encargo", client: "Cliente A" },
        { title: "Revisar la web de Cliente C antes de entregarla", description: "En «Revisión», si sacas la tarjeta con alguna subtarea sin marcar, avisa.", column: 3, kind: "Encargo", client: "Cliente C", subtasks: ["Probar en el móvil", "Revisar los textos"] },
        { title: "Enviar las facturas del mes", description: "Las tarjetas de «Tareas periódicas» se repiten solas: al pasarlas a «Hecho» aparece la siguiente.", column: 4, kind: "Facturación", recurrence: "MONTHLY", recurrenceDay: 1 },
        { title: "Cobrar la factura de marzo", description: "Lo terminado queda en «Hecho» y cuenta como avance en los informes.", column: 5, kind: "Facturación", client: "Cliente B", cost: 950 },
      ],
    },
    en: {
      tasks: [
        { title: "Welcome: how this board works", description: WELCOME_EN + "\n\nClient, priority and cost are card fields: you can filter and group by them. Turn on others in the project settings (hours, start date).", column: 0, kind: "Job" },
        { title: "Quote for the shop redesign", description: "The cost stays on the card. If the client accepts, drag it to “In progress”.", column: 0, kind: "Proposal or quote", client: "Client A", cost: 1800 },
        { title: "Catalog design", description: "The “Client” field lets you filter and group jobs by client.", column: 1, kind: "Job", client: "Client B", priority: "ALTA", dueInDays: 6, subtasks: ["First draft", "Review with the client", "Final version"] },
        { title: "Waiting for logo approval", description: "In “Waiting”, the card reminds its assignee (or, without one, whoever created it) if several days pass without a reply.", column: 2, kind: "Job", client: "Client A" },
        { title: "Check Client C's website before delivery", description: "In “Review”, moving the card out with an unchecked subtask shows a warning.", column: 3, kind: "Job", client: "Client C", subtasks: ["Try it on a phone", "Proofread the copy"] },
        { title: "Send this month's invoices", description: "Cards in “Periodic tasks” repeat on their own: move one to “Done” and the next one appears.", column: 4, kind: "Invoicing", recurrence: "MONTHLY", recurrenceDay: 1 },
        { title: "Collect the March invoice", description: "Finished work stays in “Done” and counts as progress in the reports.", column: 5, kind: "Invoicing", client: "Client B", cost: 950 },
      ],
    },
  },

  // --- Casa y familia -------------------------------------------------------------------------------------------
  // Columnas: 0 Por hacer, 1 Esta semana, 2 Esperando, 3 Lista de la compra, 4 Citas, 5 Rutinas, 6 Hecho.
  {
    key: "casa-familia",
    es: {
      tasks: [
        { title: "Bienvenida: así se usa este tablero", description: WELCOME_ES, column: 0, kind: "Casa" },
        { title: "Arreglar el grifo de la cocina", description: "Lo de «Esta semana» se imprime en un PDF por día o por persona (menú de la columna).", column: 1, kind: "Casa", labels: ["Urgente"] },
        { title: "Presupuesto para pintar el salón", description: "En «Esperando», la tarjeta avisa si pasan varios días sin respuesta. El importe va en el campo «Coste».", column: 2, kind: "Reforma u obra", cost: 600 },
        { title: "Lista de la compra", description: "La columna «Lista de la compra» reúne las subtareas de todas sus tarjetas en una lista única que puedes abrir o imprimir (menú de la columna).", column: 3, kind: "Compras", subtasks: ["Leche", "Pan", "Fruta", "Detergente"] },
        { title: "Revisión del dentista", description: "En «Citas», las tarjetas con fecha salen en el Calendario (y en el del móvil si te suscribes).", column: 4, kind: "Cita", dueInDays: 7 },
        { title: "Sacar la basura", description: "Las tarjetas de «Rutinas» se repiten solas: al pasarlas a «Hecho» aparece la siguiente.", column: 5, kind: "Casa", recurrence: "WEEKLY", recurrenceDay: 2 },
        { title: "Limpieza a fondo", description: "Repetición semanal, los sábados.", column: 5, kind: "Casa", recurrence: "WEEKLY", recurrenceDay: 6 },
      ],
    },
    en: {
      tasks: [
        { title: "Welcome: how this board works", description: WELCOME_EN, column: 0, kind: "Home" },
        { title: "Fix the kitchen faucet", description: "Whatever is in “This week” prints as a PDF by day or by person (column menu).", column: 1, kind: "Home", labels: ["Urgent"] },
        { title: "Quote for painting the living room", description: "In “Waiting”, the card reminds you if several days pass without a reply. The amount goes in the “Cost” field.", column: 2, kind: "Renovation or repair", cost: 600 },
        { title: "Shopping list", description: "The “Shopping list” column gathers the subtasks of all its cards into a single list you can open or print (column menu).", column: 3, kind: "Shopping", subtasks: ["Milk", "Bread", "Fruit", "Detergent"] },
        { title: "Dentist checkup", description: "In “Appointments”, cards with a date show up in the Calendar (and on your phone if you subscribe).", column: 4, kind: "Appointment", dueInDays: 7 },
        { title: "Take out the trash", description: "Cards in “Routines” repeat on their own: move one to “Done” and the next one appears.", column: 5, kind: "Home", recurrence: "WEEKLY", recurrenceDay: 2 },
        { title: "Deep clean", description: "Repeats weekly, on Saturdays.", column: 5, kind: "Home", recurrence: "WEEKLY", recurrenceDay: 6 },
      ],
    },
  },

  // --- Eventos y viajes -----------------------------------------------------------------------------------------
  // Columnas: 0 Ideas, 1 Por confirmar, 2 Reservado, 3 Preparando, 4 Agenda, 5 Lista del día y maleta, 6 Hecho.
  {
    key: "eventos-viajes",
    es: {
      deliverables: [
        { name: "Lugar reservado", description: "Sala elegida y señal pagada.", dueInDays: 14 },
        { name: "Invitaciones enviadas", dueInDays: 28 },
        { name: "Día del evento", dueInDays: 60 },
      ],
      tasks: [
        { title: "Bienvenida: así se usa este tablero", description: WELCOME_ES + "\n\nLos **entregables** (hitos con fecha) se ven en el calendario del proyecto y se asignan a cada tarjeta.", column: 0, kind: "Actividad o programa" },
        { title: "Pedir presupuesto de catering", description: "En «Por confirmar» una tarjeta avisa a su responsable (o, sin él, a quien la creó) si lleva varios días sin moverse.", column: 1, kind: "Proveedor" },
        { title: "Alquiler de sonido", description: "En la columna «Reservado» se suma el coste de sus tarjetas.", column: 2, kind: "Proveedor", cost: 450 },
        { title: "Elegir el lugar", description: "Está vinculada al entregable «Lugar reservado», que aparece en el calendario.", column: 3, kind: "Lugar o alojamiento", deliverable: 0, dueInDays: 10, subtasks: ["Visitar dos salas", "Comparar condiciones", "Reservar"] },
        { title: "Enviar las invitaciones", description: "Cada tarjeta puede tener fecha límite y entregable.", column: 3, kind: "Invitados", deliverable: 1, dueInDays: 28, subtasks: ["Cerrar la lista", "Enviar el correo", "Confirmar asistencia"] },
        { title: "Programa del día", description: "En «Agenda», las tarjetas con fecha salen en el Calendario (y en el del móvil si te suscribes).", column: 4, kind: "Actividad o programa", deliverable: 2, dueInDays: 60 },
        { title: "Lo que hay que llevar el día del evento", description: "La columna reúne las subtareas de todas sus tarjetas en una lista única que puedes imprimir (menú de la columna).", column: 5, kind: "Maleta y material", labels: ["Imprescindible"], subtasks: ["Lista de invitados impresa", "Cargadores", "Cinta y tijeras"] },
      ],
    },
    en: {
      deliverables: [
        { name: "Venue booked", description: "Room chosen and deposit paid.", dueInDays: 14 },
        { name: "Invitations sent", dueInDays: 28 },
        { name: "Event day", dueInDays: 60 },
      ],
      tasks: [
        { title: "Welcome: how this board works", description: WELCOME_EN + "\n\n**Deliverables** (milestones with a date) show on the project calendar and are assigned to each card.", column: 0, kind: "Activity or program" },
        { title: "Ask for a catering quote", description: "In “To confirm”, a card reminds its assignee (or, without one, whoever created it) if it has not moved for a few days.", column: 1, kind: "Supplier" },
        { title: "Sound equipment rental", description: "The “Booked” column adds up the cost of its cards.", column: 2, kind: "Supplier", cost: 450 },
        { title: "Choose the venue", description: "Linked to the “Venue booked” deliverable, which shows on the calendar.", column: 3, kind: "Venue or accommodation", deliverable: 0, dueInDays: 10, subtasks: ["Visit two rooms", "Compare terms", "Book it"] },
        { title: "Send the invitations", description: "Every card can have a due date and a deliverable.", column: 3, kind: "Guests", deliverable: 1, dueInDays: 28, subtasks: ["Close the list", "Send the email", "Confirm attendance"] },
        { title: "Program for the day", description: "In “Agenda”, cards with a date show up in the Calendar (and on your phone if you subscribe).", column: 4, kind: "Activity or program", deliverable: 2, dueInDays: 60 },
        { title: "What to bring on the day", description: "The column gathers the subtasks of all its cards into a single list you can print (column menu).", column: 5, kind: "Packing and supplies", labels: ["Must-have"], subtasks: ["Printed guest list", "Chargers", "Tape and scissors"] },
      ],
    },
  },

  // --- Estudios y aprendizaje -----------------------------------------------------------------------------------
  // Columnas: 0 Pendiente, 1 Estudiando, 2 Repasos, 3 Esperando corrección, 4 Corrigiendo, 5 Hecho.
  {
    key: "estudios-tesis",
    es: {
      tasks: [
        { title: "Bienvenida: así se usa este tablero", description: WELCOME_ES, column: 0, kind: "Tema o lección" },
        { title: "Tema: conceptos básicos", description: "Las subtareas marcan el avance; el campo «Horas» guarda el tiempo previsto y el dedicado.", column: 1, kind: "Tema o lección", labels: ["Bloque 1"], dueInDays: 3, estimatedHours: 2, subtasks: ["Leer o ver la lección", "Hacer un esquema o resumen", "Hacer los ejercicios"] },
        { title: "Practicar: fichas de repaso", description: "Las tarjetas de «Repasos» se repiten solas: al pasarlas a «Hecho» aparece la siguiente.", column: 2, kind: "Práctica", recurrence: "WEEKLY", recurrenceDay: 1 },
        { title: "Redactar: primer trabajo", description: "En «Esperando corrección» la tarjeta avisa si pasan varios días sin respuesta del profesor o del tutor.", column: 3, kind: "Redacción", labels: ["Bloque 1"] },
        { title: "Examen del bloque 1", description: "Con fecha de inicio y fecha límite, el calendario muestra el periodo de estudio.", column: 0, kind: "Examen o entrega", labels: ["Bloque 1"], startInDays: 21, dueInDays: 30, subtasks: ["Repasar todo el temario", "Simulacro o revisión final"] },
      ],
    },
    en: {
      tasks: [
        { title: "Welcome: how this board works", description: WELCOME_EN, column: 0, kind: "Topic or lesson" },
        { title: "Topic: the basics", description: "Subtasks show your progress; the “Hours” field keeps the time planned and spent.", column: 1, kind: "Topic or lesson", labels: ["Block 1"], dueInDays: 3, estimatedHours: 2, subtasks: ["Read or watch the lesson", "Make an outline or summary", "Do the exercises"] },
        { title: "Practice: review flashcards", description: "Cards in “Reviews” repeat on their own: move one to “Done” and the next one appears.", column: 2, kind: "Practice", recurrence: "WEEKLY", recurrenceDay: 1 },
        { title: "Write: first assignment", description: "In “Waiting for feedback”, the card reminds you if several days pass without a reply from the teacher or supervisor.", column: 3, kind: "Writing", labels: ["Block 1"] },
        { title: "Block 1 exam", description: "With a start date and a due date, the calendar shows the study period.", column: 0, kind: "Exam or submission", labels: ["Block 1"], startInDays: 21, dueInDays: 30, subtasks: ["Go over the whole syllabus", "Practice exam or final check"] },
      ],
    },
  },

  // --- Curso o charla -------------------------------------------------------------------------------------------
  // Columnas: 0 Ideas, 1 Materiales, 2 Ejercicios y exámenes, 3 Plan de trabajo para IA, 4 Programa,
  // 5 Seguimiento de alumnos, 6 Publicado.
  {
    key: "curso-master",
    es: {
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
        {
          title: "Material: Guía del curso",
          description: "Lo ya publicado para los alumnos pasa a «Publicado»: cuenta como terminado en los informes.",
          column: 6, kind: "Preparar material", labels: ["Módulo 1"],
        },
      ],
    },
    en: {
      tasks: [
        {
          title: "Welcome: how this board works",
          description:
            WELCOME_EN +
            "\n\nIn **Program** each card is a session of the course, with its date. “Publish program (PDF)” generates the program with the sessions in that order and saves a copy in Documentation.\n\n" +
            "When you choose a type (Prepare material, Prepare exercise, Prepare exam…) the description is filled in with a brief for an AI agent: objective, content, delivery format, duration, criteria and notes for the agent.\n\n" +
            "Move the briefs you want to give the agent to **AI work plan** and click “Generate work plan”: you get a Markdown text with the instructions and every task, ready to paste into Claude Code or save in Documentation. Those under “Always in the plan” go into every plan.",
          column: 0,
          kind: "Prepare material",
        },
        {
          title: "Session: Course introduction",
          description: "**Objectives:** get to know the course, the calendar and how it is assessed.\n\n**Topics:**\n\n- Teachers and students introduce themselves\n- Program and calendar\n- Assessment criteria\n\n**Activities:** round of introductions.\n\n**Readings and materials:** course guide.",
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
          title: "Exam: Module 1 midterm",
          description: "The “Coordination review” label means another teacher or the coordinators must approve it.",
          column: 2, kind: "Prepare exam", labels: ["Module 1", "Coordination review"], dueInDays: 35, subtasks: ["Prepare the questions", "Prepare the grading rubric"],
        },
        {
          title: "Exercise: Module 1 case studies",
          description: "**Objective:** practice the key concepts of module 1.\n\n**Task or topic:** three short cases, from easier to harder.\n\n**Delivery format:** Markdown\n\n**Estimated time:** 45 minutes\n\n**Grading criteria:** the right concept is applied and the answer is justified.\n\n**Notes for the agent:** also prepare the solution.",
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
        {
          title: "Material: Course guide",
          description: "Whatever is already published for students goes to “Published”: it counts as finished in the reports.",
          column: 6, kind: "Prepare material", labels: ["Module 1"],
        },
      ],
    },
  },
];

function examplesByKey(key: string | null | undefined): BuiltinExamples | undefined {
  return key ? PROJECT_EXAMPLES.find((e) => e.key === key) : undefined;
}

/** ¿La plantilla de serie `key` tiene tarjetas de ejemplo? */
export function hasExamples(key: string | null | undefined): boolean {
  return !!examplesByKey(key);
}

/** La plantilla canónica de serie en un idioma. */
const canonicalIn = (key: string, locale: ExampleLocale) => (locale === "en" ? canonicalTemplateEn(key) : canonicalTemplate(key));

export interface ResolvedExamples {
  content: ExampleContent;
  /** Plantilla canónica en el idioma de las tarjetas: sus columnas dan el nombre y el rol de cada `column`. */
  canonical: TemplateData;
  /** Nombre de la etiqueta de las tarjetas de muestra. */
  exampleLabel: string;
  /** La plantilla que se aplicará, con la etiqueta de ejemplo añadida si no la tenía. */
  template: TemplateData;
}

/**
 * Las tarjetas de ejemplo de la plantilla de serie `key` para la plantilla que se va a aplicar (la guardada, quizá
 * modificada, o su versión inglesa). El idioma de las tarjetas es el de la plantilla: el que tenga más columnas y tipos
 * con los mismos nombres; si empatan, el de quien crea el proyecto. Null si esa plantilla no tiene ejemplos.
 */
export function resolveExamples(key: string, template: TemplateData, userLocale: ExampleLocale): ResolvedExamples | null {
  const examples = examplesByKey(key);
  if (!examples) return null;
  const names = new Set([...template.columns, ...template.kinds].map((x) => x.name.trim().toLowerCase()));
  const score = (locale: ExampleLocale) => {
    const c = canonicalIn(key, locale);
    return c ? [...c.columns, ...c.kinds].filter((x) => names.has(x.name.trim().toLowerCase())).length : -1;
  };
  const es = score("es");
  const en = score("en");
  const locale: ExampleLocale = es === en ? userLocale : en > es ? "en" : "es";
  const canonical = canonicalIn(key, locale);
  if (!canonical) return null;
  const label = EXAMPLE_LABEL[locale];
  const hasLabel = template.labels.some((l) => l.name.trim().toLowerCase() === label.name.toLowerCase());
  // Con la plantilla ya en el máximo de etiquetas de un proyecto no se añade: las tarjetas de muestra salen sin ella.
  const keep = hasLabel || template.labels.length >= MAX_LABELS_PER_PROJECT;
  return { content: examples[locale], canonical, exampleLabel: label.name, template: keep ? template : { ...template, labels: [...template.labels, label] } };
}

const FIELD_OF_TASK: Record<string, TaskFieldKey> = { priority: "priority", cost: "cost", estimatedHours: "hours", client: "client", startInDays: "startDate" };

/**
 * Errores de coherencia de las tarjetas de ejemplo con su plantilla canónica (vacío = válido): lo usan las pruebas y
 * evita que una errata llegue a producción.
 */
export function validateExample(content: ExampleContent, tpl: TemplateData): string[] {
  const errors: string[] = [];
  const kindNames = new Set(tpl.kinds.map((k) => k.name.toLowerCase()));
  const labelNames = new Set(tpl.labels.map((l) => l.name.toLowerCase()));
  const deliverables = content.deliverables ?? [];
  if (!content.tasks.length) errors.push("sin tarjetas de muestra");
  if (content.tasks.length > 10) errors.push("demasiadas tarjetas de muestra (máximo 10)");
  content.tasks.forEach((task, i) => {
    const at = `tarjeta ${i + 1} («${task.title}»)`;
    if (!task.title.trim() || task.title.length > MAX_TITLE) errors.push(`${at}: título vacío o demasiado largo`);
    if ((task.description ?? "").length > MAX_DESCRIPTION) errors.push(`${at}: descripción demasiado larga`);
    if (!Number.isInteger(task.column) || task.column < 0 || task.column >= tpl.columns.length) errors.push(`${at}: columna fuera de rango`);
    if (!!task.kind === !!task.generalKind) errors.push(`${at}: indica exactamente un tipo (kind o generalKind)`);
    if (task.kind && !kindNames.has(task.kind.toLowerCase())) errors.push(`${at}: el tipo «${task.kind}» no está en la plantilla`);
    if (task.generalKind && !(task.generalKind in GENERAL_KIND_IDS)) errors.push(`${at}: tipo general desconocido`);
    if (task.generalKind && tpl.hideAllGeneralKinds) errors.push(`${at}: la plantilla oculta los tipos generales`);
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
