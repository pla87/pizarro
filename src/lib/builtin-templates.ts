// Plantillas de proyecto incluidas de serie. La definición canónica vive aquí; en la base de datos cada
// una es una fila normal de ProjectTemplate con su `builtinKey`, que el administrador puede editar o borrar.
import { templateInputSchema, type TemplateData, type TemplateInput } from "./project-templates";
import { GENERAL_ROLE_CHOICES, ROLE_CHOICES, type ColumnRoleChoice } from "./column-role-choices";

type Col = TemplateInput["columns"][number];
type Kind = NonNullable<TemplateInput["kinds"]>[number];

/** Columna de una plantilla de serie; `defaultKind`, el nombre de su «Tipo por defecto» (de la misma plantilla). */
export const col = (name: string, isDone = false, role: Col["role"] = "NONE", defaultKind?: string): Col => ({ name, role, isDone, ...(defaultKind ? { defaultKind } : {}) });
export const kind = (name: string, color: string, titleTemplate: string, descriptionTemplate: string, subtaskTemplate: string[] = []): Kind => ({
  name,
  color,
  titleTemplate,
  descriptionTemplate,
  subtaskTemplate,
});

interface BuiltinTemplate {
  /** Identificador estable: no cambia aunque se renombre la plantilla. */
  key: string;
  data: TemplateInput;
}

export const BUILTIN_TEMPLATES: BuiltinTemplate[] = [
  {
    key: "vibecoding",
    data: {
      name: "Vibecoding",
      description: "Construir software con asistentes de IA: de la idea a producción, con revisión humana antes de cada release.",
      columns: [
        col("Ideas"),
        col("Backlog"),
        col("En curso con la IA"),
        col("Revisar y probar"),
        col("Siguiente release", false, "NEXT_RELEASE"),
        col("En producción", true, "IN_PRODUCTION"),
      ],
      // Funcionalidad, Corrección y Respuesta ya son tipos generales: aquí solo se añaden los propios. Sus subtareas son
      // criterios comprobables de la tarea (llegan al plan para IA como criterios de aceptación), no pasos de la persona.
      kinds: [
        kind("Mejora", "#0ea5e9", "", "**Qué mejora:**\n\n**Por qué:**\n\n**Cómo sabré que está bien:**\n", ["Funciona en local", "Hay una prueba que lo cubre", "Sin errores en la consola"]),
        kind(
          "Prompt e investigación",
          "#a855f7",
          "",
          "**Pregunta o prompt:**\n\n**Contexto que tiene que saber la IA:**\n\n**Resultado esperado:**\n",
          ["El prompt lleva el contexto necesario", "La respuesta está contrastada", "Lo aprendido queda anotado en la tarea"],
        ),
        kind("Refactorización", "#6366f1", "Refactor: ", "**Qué se limpia:**\n\n**Riesgo:** sin cambios visibles para el usuario.\n", ["Las pruebas cubren lo que se toca", "Todas las pruebas pasan", "Sin cambios visibles para el usuario"]),
        kind("Despliegue", "#14b8a6", "Desplegar ", "**Versión o cambio:**\n\n**Variables o migraciones nuevas:**\n", ["Migraciones revisadas", "Variables de entorno configuradas", "Desplegado en producción", "Prueba rápida en producción correcta"]),
      ],
      hiddenGeneralKinds: [],
      hideAllGeneralKinds: false,
      labels: [
        { name: "Bloqueado por la IA", color: "#ef4444" },
        { name: "Necesita revisión", color: "#f97316" },
        { name: "Frontend", color: "#0ea5e9" },
        { name: "Backend", color: "#6366f1" },
        { name: "Deuda técnica", color: "#8b5a2b" },
      ],
    },
  },
  {
    // Trabajo con clientes (negocio pequeño, autónomos, agencias, soporte, mantenimiento…): lo que depende de otros
    // avisa si tarda (Esperando), la revisión avisa si faltan pasos (Revisión con requisitos) y lo periódico (facturas,
    // impuestos, revisiones) se repite solo. Prioridad, cliente y coste son campos, no etiquetas.
    key: "trabajo-clientes",
    data: {
      name: "Trabajo y clientes",
      description: "Encargos, propuestas, incidencias y tareas internas de un negocio o un profesional, con cliente, prioridad y coste, aviso cuando algo espera demasiado y tareas periódicas que se repiten solas.",
      columns: [
        col("Pendiente"),
        col("En curso"),
        col("Esperando", false, "WAITING"),
        col("Revisión", false, "REVIEW"),
        col("Tareas periódicas", false, "ROUTINES"),
        col("Hecho", true),
      ],
      kinds: [
        kind("Encargo", "#6366f1", "", "**Qué pide el cliente:**\n\n**Plazo acordado:**\n\n**Qué se entrega:**\n", ["Aclarar lo que necesita", "Hacer el trabajo", "Entregar y confirmar con el cliente"]),
        kind("Propuesta o presupuesto", "#eab308", "Propuesta: ", "**Qué incluye:**\n\n**Importe y condiciones:**\n\n**Válida hasta:**\n", ["Preparar la propuesta", "Revisarla", "Enviarla", "Llamar para comentarla"]),
        kind("Reunión", "#a855f7", "Reunión: ", "**Con quién:**\n\n**Fecha y formato:**\n\n**Objetivo:**\n\n**Acuerdos y siguiente paso:**\n", ["Preparar la reunión", "Enviar el resumen y los acuerdos"]),
        kind("Incidencia", "#ef4444", "Incidencia: ", "**Qué ocurre:**\n\n**Dónde y a quién afecta:**\n\n**Solución aplicada:**\n", ["Confirmar el problema", "Buscar la causa", "Resolverlo", "Avisar al cliente"]),
        kind("Facturación", "#22c55e", "", "**Concepto e importe:**\n\n**Vencimiento:**\n", ["Emitir o registrar la factura", "Comprobar el cobro o el pago", "Archivar el justificante"]),
        kind("Contenido o campaña", "#ec4899", "", "**Objetivo y público:**\n\n**Canal:**\n\n**Fecha de publicación:**\n", ["Redactar el texto", "Preparar la imagen o el vídeo", "Revisar y programar"]),
        kind("Tarea interna", "#64748b", "", "**Qué hay que hacer:**\n\n**Proveedor u organismo:**\n\n**Plazo:**\n"),
      ],
      hiddenGeneralKinds: [],
      hideAllGeneralKinds: true,
      labels: [
        { name: "Bloqueado", color: "#f97316" },
        { name: "Reabierto", color: "#eab308" },
        { name: "En garantía", color: "#0ea5e9" },
      ],
      taskFields: ["priority", "client", "cost"],
    },
  },
  {
    // Casa y familia (también mudanzas y reformas): lo de esta semana se imprime por persona (Planificación semanal), lo
    // que depende de otros avisa si tarda (Esperando), la compra es una lista única (Lista consolidada: cada producto es
    // una subtarea), las citas tienen su columna (con fecha, salen en el calendario) y lo que se repite, a Rutinas.
    key: "casa-familia",
    data: {
      name: "Casa y familia",
      description: "Compras, tareas de casa, papeleo, citas, reformas y mudanzas, con la semana por persona, la lista de la compra y tareas que se repiten solas.",
      columns: [
        col("Por hacer"),
        col("Esta semana", false, "WEEKLY_PLAN"),
        col("Esperando", false, "WAITING"),
        col("Lista de la compra", false, "CHECKLIST", "Compras"),
        col("Citas", false, "NONE", "Cita"),
        col("Rutinas", false, "ROUTINES"),
        col("Hecho", true),
      ],
      kinds: [
        // Sin subtareas de serie: en «Lista de la compra» cada subtarea es un producto de la lista.
        kind("Compras", "#22c55e", "Comprar ", "**Dónde:**\n\n**Para cuándo:**\n"),
        kind("Casa", "#f97316", "", "**Qué hay que hacer:**\n\n**Material necesario:**\n"),
        kind("Papeleo", "#64748b", "Gestionar ", "**Trámite:**\n\n**Documentos necesarios:**\n\n**Plazo:**\n", ["Reunir documentos", "Pedir cita o hacerlo online", "Archivar el justificante"]),
        kind("Cita", "#6366f1", "Cita: ", "**Quién:**\n\n**Dónde y cuándo:**\n\n**Qué preguntar o llevar:**\n", ["Pedir la cita", "Preparar documentación", "Apuntar indicaciones"]),
        kind("Reforma u obra", "#8b5a2b", "Obra: ", "**Estancia o zona:**\n\n**Qué hay que hacer:**\n\n**Quién lo hace y presupuesto:**\n\n**Fechas previstas:**\n", ["Pedir presupuestos", "Acordar la fecha", "Seguimiento durante la obra", "Revisar el resultado y pagar"]),
        kind("Mudanza", "#0ea5e9", "Mudanza: ", "**Qué hay que hacer (trámites, embalaje, transporte, suministros):**\n\n**Fecha:**\n", ["Pedir presupuestos de transporte", "Embalar y etiquetar", "Cambiar la dirección y los suministros", "Entregar las llaves"]),
      ],
      hiddenGeneralKinds: [],
      hideAllGeneralKinds: true,
      labels: [
        { name: "Persona 1", color: "#0ea5e9" },
        { name: "Persona 2", color: "#ec4899" },
        { name: "Toda la familia", color: "#a855f7" },
        { name: "Urgente", color: "#ef4444" },
      ],
      // Coste para presupuestos y compras grandes; fecha de inicio para las obras de varios días.
      taskFields: ["cost", "startDate"],
    },
  },
  {
    // Evento o viaje: lo pedido a proveedores avisa si no responden (Esperando), lo reservado suma su coste con pagado y
    // pendiente (Presupuesto), el programa o el itinerario tiene su columna (con fecha, sale en el calendario) y lo del día, maleta incluida, se ve
    // como una sola lista (Lista consolidada).
    key: "eventos-viajes",
    data: {
      name: "Eventos y viajes",
      description: "Organizar un evento o un viaje: lugar o alojamiento, transporte, proveedores, invitados y programa, con el presupuesto de lo reservado, las fechas en el calendario y una lista única para el día o la maleta.",
      columns: [
        col("Ideas"),
        col("Por confirmar", false, "WAITING", "Proveedor"),
        col("Reservado", false, "BUDGET", "Proveedor"),
        col("Preparando"),
        col("Agenda", false, "NONE", "Actividad o programa"),
        col("Lista del día y maleta", false, "CHECKLIST", "Maleta y material"),
        col("Hecho", true),
      ],
      kinds: [
        kind("Lugar o alojamiento", "#6366f1", "", "**Opciones:**\n\n**Fechas, aforo y precio:**\n\n**Condiciones de cancelación:**\n", ["Comparar opciones", "Reservar", "Guardar la confirmación"]),
        kind("Transporte", "#0ea5e9", "Transporte: ", "**Trayecto y fechas:**\n\n**Compañía y referencia de reserva:**\n\n**Horarios:**\n", ["Comparar precios", "Reservar", "Guardar los billetes"]),
        kind("Proveedor", "#f97316", "Proveedor: ", "**Servicio (catering, música, fotografía…):**\n\n**Contacto:**\n\n**Presupuesto y señal:**\n", ["Pedir presupuesto", "Comparar opciones", "Confirmar y pagar la señal"]),
        kind("Invitados", "#ec4899", "", "**Lista y número de personas:**\n\n**Necesidades especiales:**\n", ["Cerrar la lista", "Enviar invitaciones", "Confirmar asistencia"]),
        kind("Actividad o programa", "#a855f7", "", "**Qué y dónde:**\n\n**Día, hora y duración:**\n\n**Quién interviene o qué se necesita:**\n", ["Cerrar el horario", "Reservar o confirmar", "Avisar a los demás"]),
        kind("Documentación", "#64748b", "Documentación: ", "**Qué documento:**\n\n**Quién lo necesita:**\n\n**Caducidad o plazo:**\n", ["Comprobar la vigencia", "Tramitarlo si hace falta", "Guardar copia digital"]),
        // Para «Lista del día y maleta»: sus subtareas entran en la lista única.
        kind("Maleta y material", "#14b8a6", "", "**Para quién o para qué:**\n\n**No olvidar:**\n\n- \n", ["Documentación y billetes", "Cargadores y adaptador", "Medicinas", "Ropa según el clima"]),
      ],
      hiddenGeneralKinds: [],
      hideAllGeneralKinds: true,
      labels: [
        { name: "Imprescindible", color: "#a855f7" },
        { name: "Opcional", color: "#64748b" },
        { name: "Cancelación gratuita", color: "#22c55e" },
      ],
      // Fecha de inicio: el alojamiento, los trayectos y las actividades van de una fecha a otra.
      taskFields: ["cost", "startDate"],
    },
  },
  {
    // Aprender cualquier cosa (cursos, oposiciones, idiomas, una tesis): los repasos se repiten solos (Rutinas), lo que
    // espera la corrección del profesor o del tutor avisa si tarda (Esperando) y las correcciones son subtareas que avisan
    // si se entrega con alguna pendiente (Revisión con requisitos). Conserva la clave de «Estudios o tesis».
    key: "estudios-tesis",
    data: {
      name: "Estudios y aprendizaje",
      description: "Aprender cualquier cosa: un curso, unas oposiciones, un idioma o una tesis. Temas, lecturas, práctica, repasos que se repiten solos, correcciones, entregas y exámenes.",
      columns: [
        col("Pendiente"),
        col("Estudiando"),
        col("Repasos", false, "ROUTINES"),
        col("Esperando corrección", false, "WAITING"),
        col("Corrigiendo", false, "REVIEW", "Correcciones"),
        col("Hecho", true),
      ],
      kinds: [
        kind("Tema o lección", "#0ea5e9", "Tema: ", "**Tema o unidad:**\n\n**Qué tengo que saber:**\n\n- \n\n**Materiales:**\n", ["Leer o ver la lección", "Hacer un esquema o resumen", "Hacer los ejercicios"]),
        kind("Lectura", "#8b5a2b", "Leer: ", "**Fuente:**\n\n**Para qué:**\n\n**Ideas principales:**\n", ["Leer", "Resumir", "Guardar la referencia"]),
        kind("Práctica", "#22c55e", "Practicar: ", "**Qué se practica (ejercicios, conversación, problemas):**\n\n**Tiempo:**\n\n**Dudas:**\n", ["Hacer los ejercicios", "Corregirlos", "Apuntar los errores"]),
        kind("Redacción", "#6366f1", "Redactar: ", "**Trabajo, capítulo o apartado:**\n\n**Esquema:**\n\n- \n\n**Extensión prevista:**\n", ["Esquema", "Primer borrador", "Revisar el estilo", "Comprobar las citas"]),
        kind("Tutoría o clase", "#a855f7", "Tutoría: ", "**Fecha:**\n\n**Qué hay que llevar:**\n\n**Dudas:**\n\n**Acuerdos:**\n", ["Preparar las dudas", "Anotar los acuerdos"]),
        // En «Corrigiendo» cada comentario recibido es una subtarea: al sacar la tarjeta con alguno sin hacer, avisa.
        kind("Correcciones", "#f97316", "Corregir: ", "**Trabajo o apartado:**\n\n**Fecha de la próxima entrega:**\n\n**Comentarios recibidos (uno por subtarea):**\n"),
        kind("Examen o entrega", "#ef4444", "", "**Qué es (examen, entrega o defensa):**\n\n**Fecha y lugar:**\n\n**Qué entra o qué requisitos tiene:**\n", ["Repasar todo el temario", "Simulacro o revisión final", "Preparar lo que hay que llevar o entregar"]),
      ],
      hiddenGeneralKinds: [],
      hideAllGeneralKinds: true,
      labels: [
        { name: "Bloque 1", color: "#0ea5e9" },
        { name: "Bloque 2", color: "#6366f1" },
        { name: "Duda", color: "#f97316" },
        { name: "Me cuesta", color: "#ef4444" },
      ],
      // Fecha de inicio para lo que dura varios días y horas para planificar el tiempo de estudio.
      taskFields: ["hours", "startDate"],
    },
  },
  {
    // Preparar un curso con ayuda de un agente (p. ej. Claude Code en la web): la descripción de cada tipo deja escrito
    // el encargo (objetivo, contenido, formato de entrega, duración, criterios y notas para el agente). La columna
    // «Plan de trabajo para IA» (rol AI_PLAN) reúne los encargos y genera el plan en Markdown para el agente, y
    // «Programa» (rol PROGRAM) tiene una tarjeta por sesión y publica el programa en PDF. Lo ya publicado para los alumnos
    // pasa a «Publicado» (terminada: cuenta como avance en los informes). Sin datos de alumnos.
    key: "curso-master",
    data: {
      name: "Curso o charla",
      description: "Preparar un curso, un máster o una charla con ayuda de un agente de IA: plan de trabajo para el agente, programa por sesiones publicable en PDF, materiales, ejercicios y exámenes, y seguimiento de alumnos.",
      columns: [
        col("Ideas"),
        col("Materiales", false, "NONE", "Preparar material"),
        col("Ejercicios y exámenes"),
        col("Plan de trabajo para IA", false, "AI_PLAN"),
        col("Programa", false, "PROGRAM", "Sesión"),
        col("Seguimiento de alumnos", false, "NONE", "Revisar perfil de alumno"),
        col("Publicado", true),
      ],
      kinds: [
        // La descripción de una sesión sale en el PDF del programa: solo lo que deben leer los alumnos.
        kind("Sesión", "#6366f1", "Sesión: ", "**Objetivos:**\n\n**Contenidos:**\n\n- \n\n**Actividades:**\n\n**Lecturas y materiales:**\n", ["Preparar la presentación", "Preparar la actividad", "Subir los materiales"]),
        kind(
          "Preparar material",
          "#0ea5e9",
          "Material: ",
          "**Objetivo:**\n\n**Contenido:**\n\n- \n\n**Formato de entrega:** Google Slides, Google Docs, Markdown, PDF o HTML\n\n**Duración o extensión:**\n\n**Notas para el agente:**\n",
          ["Encargar el borrador al agente", "Revisar y corregir", "Publicar para los alumnos"],
        ),
        kind(
          "Preparar ejercicio",
          "#22c55e",
          "Ejercicio: ",
          "**Objetivo:**\n\n**Enunciado o tema:**\n\n**Formato de entrega:** Google Docs, Markdown, PDF o HTML\n\n**Duración estimada:**\n\n**Criterios de corrección:**\n\n**Notas para el agente:** prepara también la solución.\n",
          ["Redactar el enunciado", "Preparar la solución", "Probar la dificultad"],
        ),
        kind(
          "Preparar examen",
          "#ef4444",
          "Examen: ",
          "**Objetivo (qué se evalúa):**\n\n**Temario:**\n\n- \n\n**Tipo y formato:** test, preguntas cortas o caso práctico; Google Docs o PDF\n\n**Duración:**\n\n**Criterios de evaluación:**\n\n**Notas para el agente:** incluye la plantilla de corrección.\n",
          ["Preparar las preguntas", "Preparar la plantilla de corrección", "Revisión por otro profesor", "Publicar o imprimir"],
        ),
        kind("Revisar perfil de alumno", "#a855f7", "Perfil: ", "**Alumno:** [nombre o referencia]\n\n**Qué revisar:** progreso, entregas y asistencia\n\n**Observaciones:**\n\n**Siguiente paso:**\n", ["Revisar entregas y notas", "Anotar observaciones", "Decidir si necesita tutoría"]),
        kind(
          "Corregir",
          "#f97316",
          "Corregir: ",
          "**Qué se corrige:** ejercicio, examen o trabajo\n\n**Criterios:**\n\n**Plazo para devolver las notas:**\n\n**Notas para el agente:** primera pasada con los criterios; la nota final la pone el profesor.\n",
          ["Corregir", "Revisar los casos dudosos", "Publicar notas y devolución"],
        ),
        kind("Tutoría", "#14b8a6", "Tutoría: ", "**Alumno o grupo:** [nombre o referencia]\n\n**Fecha y formato:** presencial o videollamada\n\n**Temas:**\n\n**Acuerdos:**\n", ["Acordar la fecha", "Preparar los temas", "Anotar los acuerdos"]),
      ],
      hiddenGeneralKinds: [],
      hideAllGeneralKinds: true,
      labels: [
        { name: "Módulo 1", color: "#0ea5e9" },
        { name: "Módulo 2", color: "#6366f1" },
        { name: "Módulo 3", color: "#a855f7" },
        { name: "Para el agente", color: "#14b8a6" },
        { name: "Revisión de coordinación", color: "#f97316" },
        { name: "Urgente", color: "#ef4444" },
      ],
      // Fecha de inicio: una sesión puede durar varios días (el programa muestra el rango inicio–fin).
      taskFields: ["startDate"],
    },
  },
];

export const BUILTIN_KEYS = BUILTIN_TEMPLATES.map((b) => b.key);

/**
 * Plantillas de serie retiradas al pasar de 15 a 6 (se unieron en «Trabajo y clientes», «Casa y familia» y «Eventos y viajes»),
 * con la huella de su última definición canónica (`templateFingerprint`). Al arrancar, la que siga sin modificar se borra
 * y la modificada se queda como plantilla propia (`retireBuiltinTemplates`, template-store.ts). No reutilices estas claves.
 */
export const RETIRED_BUILTINS: Record<string, string> = {
  "tareas-familiares": "1f5ca7cbcd9051aaf4f3c6a896c92ecb3df502fd2bc746c8271ae24112a19a9d",
  "produccion-audiovisual": "e0dc87f01373e8efb181b040dc5e2ebbccc8da66c5c477fc24a982bc1a10e687",
  negocio: "022451911f55cc8468e0914f728c0eb5b3e0833a17a759d185c5bdd9fb406724",
  "marketing-contenidos": "75353bd4eca29834b2985d03f1750b2493b9126f21e038ea0740ddef824deaa3",
  eventos: "97837a9b1eadd43dc8f738a56d3ea17646ff6cd9cc4dd7fe8b95dcd595f2d8e4",
  "soporte-clientes": "d0b852450e82a8d3ff9e27395bee04e0948ba53ea8a6ac36475ed9d28e58d997",
  "seleccion-personal": "cbac07df7f78d5f6e7d6f75bacbb2b41bff660e93ab87ba1f56bfe61e342643e",
  "reformas-obras": "efc7bb44a70e701d5c3021233c2f2b80b4fce3e1ef46389ae5fdf5245491756f",
  viajes: "6af866684225e661d675cd7532b511d30f517ccc4f448a0814dcb9262a206878",
  mudanza: "0ced211fc262eb9adb7566fd74f9f11321f2b383b6b1879032738e23be5e1ef6",
  mantenimiento: "45eecbecc67a535540ba786588c01984fd56899a7cc7a58909250ff3c082a7d6",
  ventas: "d1fe3e45d723a19041d5eb57f9b37b5835da3bf40f023778b45422694f23efec",
};

export function builtinByKey(key: string | null | undefined): BuiltinTemplate | undefined {
  return key ? BUILTIN_TEMPLATES.find((b) => b.key === key) : undefined;
}

/** Datos canónicos validados (los mismos que pasaría una plantilla creada por un administrador). */
export function canonicalTemplate(key: string): TemplateData | null {
  const b = builtinByKey(key);
  return b ? templateInputSchema.parse(b.data) : null;
}

/** Forma comparable: campos en orden fijo, sin id ni posición. Su huella decide si una plantilla de serie está modificada o es actualizable. */
export function comparable(t: TemplateData): string {
  return JSON.stringify({
    name: t.name,
    description: t.description,
    columns: t.columns.map((c) => [c.name, c.role, c.isDone]),
    kinds: t.kinds.map((k) => [k.name, k.color, k.titleTemplate, k.descriptionTemplate, k.subtaskTemplate]),
    hidden: t.hiddenGeneralKinds,
    hideAll: t.hideAllGeneralKinds,
    labels: t.labels.map((l) => [l.name, l.color]),
    // Solo si hay: las plantillas de serie no tienen y su huella guardada no debe cambiar.
    ...(t.releaseTemplates?.length ? { releases: t.releaseTemplates.map((r) => [r.kind, r.name, r.content]) } : {}),
    // Igual con los campos de tarea: una plantilla sin campos conserva la huella que tenía antes de existir esta opción.
    ...(t.taskFields?.length ? { fields: t.taskFields } : {}),
    // Y con el tipo por defecto de las columnas: las de serie sin ninguno (las sembradas antes) conservan su huella, así que
    // las sin modificar reciben los nuevos al arrancar (upgradeBuiltinTemplates) y poner uno a mano cuenta como modificarla.
    ...(t.columns.some((c) => c.defaultKind) ? { defaults: t.columns.map((c) => c.defaultKind ?? null) } : {}),
  });
}

/** ¿La plantilla guardada difiere de la definición canónica de su `builtinKey`? Sin clave conocida, nunca. */
export function isBuiltinModified(stored: TemplateData, key: string | null | undefined): boolean {
  const canon = key ? canonicalTemplate(key) : null;
  return canon ? comparable(stored) !== comparable(canon) : false;
}

/**
 * Roles de columna que encajan con cada plantilla de serie: el submenú «Rol de la columna» los enseña primero, **en este
 * orden** (lo más usado en esa clase de proyecto arriba), y el resto va tras «Más roles…» (column-role-choices.ts). En
 * «Casa y familia» no pinta nada «Siguiente salto (genera releases)». «ASSIGN» es «Asignación a persona». Una plantilla de
 * serie nueva sin entrada aquí enseña todos los roles.
 */
const TEMPLATE_COLUMN_ROLES: Record<string, readonly ColumnRoleChoice[]> = {
  // Lo que hace el propio flujo (release, producción, plan para la IA y revisar) antes que lo de apoyo.
  vibecoding: ["NEXT_RELEASE", "IN_PRODUCTION", "AI_PLAN", "REVIEW", "WAITING", "CHECKLIST", "ASSIGN"],
  // Con clientes: esperar su respuesta y revisar es lo diario; repartir entre el equipo, antes que listas y presupuesto.
  "trabajo-clientes": ["WAITING", "REVIEW", "ROUTINES", "WEEKLY_PLAN", "ASSIGN", "BUDGET", "CHECKLIST"],
  // La semana por persona primero, y una columna para cada persona («Organizar por personas») justo después.
  "casa-familia": ["WEEKLY_PLAN", "ASSIGN", "CHECKLIST", "WAITING", "ROUTINES", "BUDGET"],
  "eventos-viajes": ["WAITING", "BUDGET", "CHECKLIST", "WEEKLY_PLAN", "ASSIGN"],
  "estudios-tesis": ["ROUTINES", "WAITING", "REVIEW", "WEEKLY_PLAN", "CHECKLIST", "AI_PLAN"],
  "curso-master": ["PROGRAM", "AI_PLAN", "REVIEW", "WAITING", "CHECKLIST", "WEEKLY_PLAN", "ASSIGN"],
};

/** `Project.templateKey` de un proyecto que sale de una plantilla propia (las de serie guardan su clave). */
export const CUSTOM_TEMPLATE_KEY = "custom";

/**
 * Roles sugeridos para el tablero de un proyecto según la plantilla de la que salió: los de su plantilla de serie o, si fue
 * una propia, los que ya tienen sus columnas más los generales. null (todos a la vista): en blanco, importado, anterior a
 * guardar la plantilla o con una clave que ya no existe.
 */
export function suggestedColumnRoles(templateKey: string | null | undefined, columns: readonly { role: string; assigneeId?: string | null; assignDueDays?: number | null }[]): ColumnRoleChoice[] | null {
  if (!templateKey) return null;
  if (templateKey === CUSTOM_TEMPLATE_KEY) {
    const own = new Set<string>(GENERAL_ROLE_CHOICES);
    for (const c of columns) {
      if (c.role !== "NONE") own.add(c.role);
      else if (c.assigneeId || c.assignDueDays != null) own.add("ASSIGN");
    }
    return ROLE_CHOICES.filter((r) => own.has(r));
  }
  // hasOwn: una clave como «constructor» (un .pizarro.zip fabricado) no debe dar lo que hereda el objeto.
  const list = Object.hasOwn(TEMPLATE_COLUMN_ROLES, templateKey) ? TEMPLATE_COLUMN_ROLES[templateKey] : undefined;
  return list ? [...list] : null;
}

/** La clave que se guarda al importar un proyecto: una plantilla de serie conocida o «custom»; cualquier otra, null. */
export function knownTemplateKey(key: string | null | undefined): string | null {
  if (!key) return null;
  return key === CUSTOM_TEMPLATE_KEY || BUILTIN_KEYS.includes(key) ? key : null;
}
