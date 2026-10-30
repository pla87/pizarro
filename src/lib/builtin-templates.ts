// Plantillas de proyecto incluidas de serie. La definición canónica vive aquí; en la base de datos cada
// una es una fila normal de ProjectTemplate con su `builtinKey`, que el administrador puede editar o borrar.
import { templateInputSchema, type TemplateData, type TemplateInput } from "./project-templates";

type Col = TemplateInput["columns"][number];
type Kind = NonNullable<TemplateInput["kinds"]>[number];

export const col = (name: string, isDone = false, role: Col["role"] = "NONE"): Col => ({ name, role, isDone });
export const kind = (name: string, color: string, titleTemplate: string, descriptionTemplate: string, subtaskTemplate: string[] = []): Kind => ({
  name,
  color,
  titleTemplate,
  descriptionTemplate,
  subtaskTemplate,
});

/** Tipos generales de software que las plantillas ajenas al software no usan. */
export const GENERALES_SOFTWARE = ["Funcionalidad", "Corrección"];

export interface BuiltinTemplate {
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
      // Funcionalidad, Corrección y Respuesta ya son tipos generales: aquí solo se añaden los propios.
      kinds: [
        kind("Mejora", "#0ea5e9", "", "**Qué mejora:**\n\n**Por qué:**\n\n**Cómo sabré que está bien:**\n", ["Pedir el cambio a la IA", "Revisar el diff", "Probarlo en local"]),
        kind(
          "Prompt e investigación",
          "#a855f7",
          "",
          "**Pregunta o prompt:**\n\n**Contexto que tiene que saber la IA:**\n\n**Resultado esperado:**\n",
          ["Escribir el prompt con el contexto", "Contrastar la respuesta", "Anotar lo aprendido"],
        ),
        kind("Refactorización", "#6366f1", "Refactor: ", "**Qué se limpia:**\n\n**Riesgo:** sin cambios visibles para el usuario.\n", ["Cubrir con pruebas lo que se toca", "Aplicar el cambio", "Comprobar que todo sigue igual"]),
        kind("Despliegue", "#14b8a6", "Desplegar ", "**Versión o cambio:**\n\n**Variables o migraciones nuevas:**\n", ["Revisar migraciones", "Comprobar variables de entorno", "Desplegar", "Prueba rápida en producción"]),
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
    key: "tareas-familiares",
    data: {
      name: "Tareas familiares",
      description: "Organización del hogar: compras, casa, papeleo y planes. Una etiqueta por persona para repartir el trabajo.",
      columns: [col("Por hacer"), col("Esta semana"), col("Hecho", true)],
      kinds: [
        kind("Compras", "#22c55e", "Comprar ", "**Qué falta:**\n\n- \n\n**Dónde:**\n", ["Hacer la lista", "Comprar", "Guardar"]),
        kind("Casa", "#f97316", "", "**Qué hay que hacer:**\n\n**Material necesario:**\n"),
        kind("Papeleo", "#64748b", "Gestionar ", "**Trámite:**\n\n**Documentos necesarios:**\n\n**Plazo:**\n", ["Reunir documentos", "Pedir cita o hacerlo online", "Archivar el justificante"]),
        kind("Salud", "#ef4444", "Cita: ", "**Quién:**\n\n**Dónde y cuándo:**\n\n**Preguntas para la consulta:**\n", ["Pedir la cita", "Preparar documentación", "Apuntar indicaciones"]),
        kind("Colegio y niños", "#eab308", "", "**Qué hay que hacer:**\n\n**Fecha límite:**\n\n**Qué hay que llevar:**\n"),
        kind("Ocio", "#ec4899", "", "**Plan:**\n\n**Cuándo y dónde:**\n\n**Quién viene:**\n", ["Elegir fecha", "Reservar", "Avisar a los demás"]),
      ],
      hiddenGeneralKinds: GENERALES_SOFTWARE,
      hideAllGeneralKinds: true,
      labels: [
        { name: "Persona 1", color: "#0ea5e9" },
        { name: "Persona 2", color: "#ec4899" },
        { name: "Persona 3", color: "#22c55e" },
        { name: "Toda la familia", color: "#a855f7" },
        { name: "Urgente", color: "#ef4444" },
      ],
    },
  },
  {
    key: "produccion-audiovisual",
    data: {
      name: "Producción audiovisual",
      description: "Del guion a la entrega: preproducción, rodaje, edición y revisiones con el cliente.",
      columns: [col("Idea"), col("Guion"), col("Preproducción"), col("Rodaje"), col("Edición"), col("Revisión cliente"), col("Entregado", true)],
      kinds: [
        kind("Guion", "#a855f7", "Guion: ", "**Sinopsis:**\n\n**Duración estimada:**\n\n**Notas del cliente:**\n", ["Primer borrador", "Revisar con el cliente", "Versión final del guion"]),
        kind("Rodaje", "#ef4444", "Rodaje: ", "**Localización:**\n\n**Fecha y horas:**\n\n**Equipo y material:**\n\n**Plano a plano:**\n", ["Confirmar localización y permisos", "Preparar material y baterías", "Enviar el plan de rodaje al equipo", "Copia de seguridad de las tarjetas"]),
        kind("Edición", "#0ea5e9", "Edición: ", "**Versión:** v1\n\n**Referencias:**\n\n**Pendiente:**\n", ["Montaje previo", "Corte fino", "Corrección de color", "Exportar la versión de revisión"]),
        kind("Sonido", "#14b8a6", "Sonido: ", "**Qué se necesita:** música, voz en off, efectos o mezcla.\n\n**Licencias:**\n", ["Elegir música y comprobar la licencia", "Limpiar y mezclar el audio", "Nivelar volúmenes"]),
        kind("Gráficos", "#f97316", "Gráficos: ", "**Qué se necesita:** títulos, rótulos, logotipos o animaciones.\n\n**Formato y resolución:**\n"),
        kind("Entrega", "#22c55e", "Entrega: ", "**Formatos pedidos:**\n\n**Destino:**\n", ["Exportar en los formatos acordados", "Revisar la exportación completa", "Enviar al cliente", "Archivar proyecto y material"]),
      ],
      hiddenGeneralKinds: GENERALES_SOFTWARE,
      hideAllGeneralKinds: true,
      labels: [
        { name: "Urgente", color: "#ef4444" },
        { name: "Pendiente del cliente", color: "#f97316" },
        { name: "Falta material", color: "#eab308" },
        { name: "Aprobado", color: "#22c55e" },
        { name: "Presupuesto", color: "#6366f1" },
      ],
    },
  },
  {
    key: "negocio",
    data: {
      name: "Negocio",
      description: "Gestión diaria de un negocio pequeño: ventas, clientes, finanzas, administración y marketing.",
      columns: [col("Backlog"), col("Esta semana"), col("En curso"), col("Esperando a terceros"), col("Hecho", true)],
      kinds: [
        kind("Ventas", "#22c55e", "", "**Cliente o contacto:**\n\n**Oportunidad:**\n\n**Siguiente paso:**\n", ["Contactar", "Enviar propuesta", "Hacer seguimiento"]),
        kind("Clientes", "#0ea5e9", "", "**Cliente:**\n\n**Qué necesita:**\n\n**Compromiso y fecha:**\n"),
        kind("Finanzas", "#eab308", "", "**Concepto e importe:**\n\n**Fecha de vencimiento:**\n", ["Reunir facturas o justificantes", "Registrar en la contabilidad"]),
        kind("Legal y administración", "#64748b", "", "**Trámite u obligación:**\n\n**Organismo o proveedor:**\n\n**Plazo:**\n", ["Reunir documentación", "Presentar o enviar", "Archivar el justificante"]),
        kind("Operaciones", "#f97316", "", "**Qué hay que hacer:**\n\n**Responsable:**\n\n**Proveedores implicados:**\n"),
        kind("Marketing", "#ec4899", "", "**Objetivo:**\n\n**Canal:**\n\n**Fecha de publicación:**\n"),
      ],
      hiddenGeneralKinds: GENERALES_SOFTWARE,
      hideAllGeneralKinds: true,
      labels: [
        { name: "Urgente", color: "#ef4444" },
        { name: "Importante", color: "#f97316" },
        { name: "Recurrente", color: "#6366f1" },
        { name: "Cobro pendiente", color: "#eab308" },
        { name: "Esperando respuesta", color: "#64748b" },
      ],
    },
  },
  {
    key: "marketing-contenidos",
    data: {
      name: "Marketing y contenidos",
      description: "Calendario editorial: de la idea a la publicación en redes, blog y newsletter.",
      columns: [col("Ideas"), col("Redacción"), col("Diseño"), col("Revisión"), col("Programado"), col("Publicado", true)],
      kinds: [
        kind("Post en redes", "#ec4899", "Post: ", "**Red social:**\n\n**Mensaje principal:**\n\n**Texto:**\n\n**Imagen o vídeo:**\n\n**Hashtags:**\n", ["Escribir el texto", "Preparar la imagen", "Programar la publicación"]),
        kind("Artículo de blog", "#0ea5e9", "Artículo: ", "**Palabra clave:**\n\n**Público:**\n\n**Esquema:**\n\n- \n\n**Llamada a la acción:**\n", ["Esquema", "Primer borrador", "Revisión SEO", "Imágenes y enlaces", "Publicar"]),
        kind("Newsletter", "#a855f7", "Newsletter: ", "**Asunto:**\n\n**Contenido destacado:**\n\n- \n\n**Llamada a la acción:**\n", ["Redactar", "Probar el envío", "Programar el envío"]),
        kind("Campaña", "#f97316", "Campaña: ", "**Objetivo:**\n\n**Público:**\n\n**Canales:**\n\n**Presupuesto:**\n\n**Fechas:**\n", ["Definir objetivo y público", "Preparar las piezas", "Lanzar la campaña", "Medir resultados"]),
        kind("Vídeo", "#ef4444", "Vídeo: ", "**Idea y duración:**\n\n**Guion:**\n\n**Plataforma:**\n", ["Guion", "Grabar", "Editar", "Miniatura y título", "Publicar"]),
      ],
      hiddenGeneralKinds: GENERALES_SOFTWARE,
      hideAllGeneralKinds: true,
      labels: [
        { name: "Instagram", color: "#ec4899" },
        { name: "LinkedIn", color: "#1e3a8a" },
        { name: "Blog", color: "#0ea5e9" },
        { name: "Newsletter", color: "#a855f7" },
        { name: "Evergreen", color: "#22c55e" },
        { name: "Urgente", color: "#ef4444" },
      ],
    },
  },
  {
    key: "eventos",
    data: {
      name: "Organización de eventos",
      description: "Del primer boceto al día del evento: lugar, proveedores, invitados, logística y presupuesto.",
      columns: [col("Ideas"), col("Por confirmar"), col("Confirmado"), col("Preparando"), col("Listo"), col("Celebrado", true)],
      kinds: [
        kind("Lugar", "#0ea5e9", "Lugar: ", "**Opciones:**\n\n**Aforo y precio:**\n\n**Condiciones (horario, montaje, cancelación):**\n", ["Pedir presupuestos", "Visitar el lugar", "Reservar y firmar"]),
        kind("Proveedores", "#f97316", "Proveedor: ", "**Servicio (catering, música, fotografía…):**\n\n**Contacto:**\n\n**Presupuesto:**\n", ["Pedir presupuesto", "Comparar opciones", "Confirmar y pagar la señal"]),
        kind("Invitados", "#ec4899", "", "**Lista y número de personas:**\n\n**Necesidades especiales:**\n", ["Cerrar la lista", "Enviar invitaciones", "Confirmar asistencia"]),
        kind("Logística", "#6366f1", "", "**Qué hay que mover o preparar:**\n\n**Cuándo y quién:**\n", ["Plan del día", "Transporte y montaje", "Recoger y desmontar"]),
        kind("Presupuesto", "#eab308", "", "**Concepto e importe:**\n\n**Pagado / pendiente:**\n"),
      ],
      hiddenGeneralKinds: GENERALES_SOFTWARE,
      hideAllGeneralKinds: true,
      labels: [
        { name: "Urgente", color: "#ef4444" },
        { name: "Pendiente de pago", color: "#eab308" },
        { name: "Esperando respuesta", color: "#64748b" },
        { name: "Confirmado", color: "#22c55e" },
        { name: "Día del evento", color: "#a855f7" },
      ],
    },
  },
  {
    key: "soporte-clientes",
    data: {
      name: "Soporte y atención al cliente",
      description: "Incidencias, consultas y reclamaciones de clientes: del primer aviso a la resolución, con seguimiento de lo que queda pendiente.",
      columns: [col("Nuevo"), col("En curso"), col("Esperando al cliente"), col("Escalado"), col("Resuelto", true)],
      kinds: [
        kind("Incidencia", "#ef4444", "Incidencia: ", "**Cliente:** [nombre o referencia]\n\n**Qué ocurre:**\n\n**Pasos para reproducirlo:**\n\n**Impacto (cuántos afectados):**\n", ["Confirmar el problema", "Buscar la causa", "Aplicar la solución", "Avisar al cliente", "Comprobar que se mantiene resuelto"]),
        kind("Consulta", "#0ea5e9", "Consulta: ", "**Cliente:**\n\n**Qué pregunta:**\n\n**Respuesta dada:**\n", ["Responder al cliente", "Confirmar que le sirve"]),
        kind("Solicitud", "#6366f1", "Solicitud: ", "**Cliente:**\n\n**Qué pide:**\n\n**Plazo acordado:**\n", ["Valorar si es posible", "Hacerlo", "Confirmar con el cliente"]),
        kind("Reclamación", "#f97316", "Reclamación: ", "**Cliente:**\n\n**Motivo:**\n\n**Qué pide el cliente:**\n\n**Propuesta de solución:**\n", ["Acusar recibo", "Revisar el historial", "Proponer solución", "Cerrar con el cliente"]),
        kind("Seguimiento", "#14b8a6", "Seguimiento: ", "**Cliente:**\n\n**Qué hay que comprobar:**\n\n**Fecha de contacto:**\n"),
        kind("Artículo de ayuda", "#a855f7", "Ayuda: ", "**Pregunta frecuente:**\n\n**Respuesta:**\n\n**Casos en que aplica:**\n", ["Redactar el artículo", "Revisarlo", "Publicarlo"]),
      ],
      hiddenGeneralKinds: [],
      hideAllGeneralKinds: true,
      labels: [
        { name: "Urgente", color: "#ef4444" },
        { name: "Cliente importante", color: "#a855f7" },
        { name: "Reabierto", color: "#f97316" },
        { name: "Pendiente de terceros", color: "#64748b" },
        { name: "Resuelto sin respuesta", color: "#eab308" },
      ],
    },
  },
  {
    key: "seleccion-personal",
    data: {
      name: "Selección de personal",
      description: "Procesos de contratación: de la vacante a la incorporación, con una tarjeta por candidato y por gestión.",
      columns: [col("Vacante abierta"), col("Preseleccionados"), col("Entrevista"), col("Prueba"), col("Oferta"), col("Contratado", true), col("Descartado", true)],
      kinds: [
        kind("Vacante", "#6366f1", "Vacante: ", "**Puesto:**\n\n**Funciones principales:**\n\n**Requisitos imprescindibles:**\n\n**Condiciones (horario, rango salarial):**\n", ["Definir el perfil", "Redactar y publicar la oferta", "Revisar las candidaturas recibidas"]),
        kind("Candidato", "#0ea5e9", "Candidato: ", "**Nombre:** [nombre del candidato]\n\n**Puesto:**\n\n**Procedencia de la candidatura:**\n\n**Primera impresión:**\n", ["Revisar el currículum", "Primer contacto", "Decidir si pasa a entrevista"]),
        kind("Entrevista", "#a855f7", "Entrevista: ", "**Candidato:**\n\n**Fecha y formato:**\n\n**Entrevistadores:**\n\n**Preguntas clave:**\n\n**Valoración:**\n", ["Acordar fecha con el candidato", "Preparar las preguntas", "Entrevistar", "Anotar la valoración"]),
        kind("Prueba", "#14b8a6", "Prueba: ", "**Candidato:**\n\n**Qué se evalúa:**\n\n**Plazo de entrega:**\n\n**Criterios de corrección:**\n", ["Enviar el enunciado", "Corregir la prueba", "Dar la devolución"]),
        kind("Oferta", "#22c55e", "Oferta: ", "**Candidato:**\n\n**Condiciones ofrecidas:**\n\n**Fecha límite de respuesta:**\n", ["Aprobar las condiciones", "Enviar la oferta", "Negociar o confirmar"]),
        kind("Incorporación", "#eab308", "Incorporación: ", "**Persona:**\n\n**Fecha de inicio:**\n\n**Material y accesos:**\n", ["Preparar contrato y alta", "Preparar equipo y accesos", "Plan de acogida del primer día", "Seguimiento tras la primera semana"]),
      ],
      hiddenGeneralKinds: [],
      hideAllGeneralKinds: true,
      labels: [
        { name: "Urgente", color: "#ef4444" },
        { name: "Muy buen perfil", color: "#22c55e" },
        { name: "En duda", color: "#eab308" },
        { name: "Esperando respuesta", color: "#64748b" },
        { name: "Referido", color: "#6366f1" },
      ],
    },
  },
  {
    key: "reformas-obras",
    data: {
      name: "Reformas y obras",
      description: "Reformar una vivienda o local: presupuestos, permisos, materiales, oficios y pagos, hasta la entrega final.",
      columns: [col("Ideas"), col("Presupuestos"), col("Permisos"), col("Planificado"), col("En obra"), col("Revisión final"), col("Terminado", true)],
      kinds: [
        kind("Presupuesto", "#eab308", "Presupuesto: ", "**Empresa o profesional:** [nombre]\n\n**Alcance incluido:**\n\n**Importe y forma de pago:**\n\n**Plazo de ejecución:**\n", ["Pedir presupuesto", "Comparar con otros", "Aceptar o rechazar"]),
        kind("Permisos y licencias", "#64748b", "Permiso: ", "**Trámite:**\n\n**Organismo:**\n\n**Documentos necesarios:**\n\n**Plazo:**\n", ["Reunir la documentación", "Presentar la solicitud", "Guardar la resolución"]),
        kind("Materiales", "#8b5a2b", "Material: ", "**Qué se necesita:**\n\n**Medidas o cantidad:**\n\n**Proveedor y plazo de entrega:**\n", ["Elegir modelo", "Pedir y pagar", "Recibir y comprobar"]),
        kind("Trabajo de obra", "#f97316", "Obra: ", "**Estancia o zona:**\n\n**Trabajo a realizar:**\n\n**Oficio responsable:**\n\n**Fechas previstas:**\n", ["Acordar fecha de inicio", "Seguimiento durante la ejecución", "Revisar el resultado"]),
        kind("Pago", "#22c55e", "Pago: ", "**Concepto y empresa:**\n\n**Importe:**\n\n**Vencimiento:**\n", ["Comprobar el trabajo hecho", "Realizar el pago", "Guardar la factura"]),
        kind("Incidencia en obra", "#ef4444", "Incidencia: ", "**Qué ha pasado:**\n\n**Quién lo resuelve:**\n\n**Coste o retraso:**\n", ["Documentar con fotos", "Avisar al responsable", "Acordar la solución"]),
      ],
      hiddenGeneralKinds: [],
      hideAllGeneralKinds: true,
      labels: [
        { name: "Urgente", color: "#ef4444" },
        { name: "Pendiente de pago", color: "#eab308" },
        { name: "Esperando material", color: "#8b5a2b" },
        { name: "Esperando al oficio", color: "#64748b" },
        { name: "Aprobado", color: "#22c55e" },
      ],
    },
  },
  {
    key: "viajes",
    data: {
      name: "Viajes",
      description: "Preparar un viaje de principio a fin: transporte, alojamiento, actividades, documentación y presupuesto.",
      columns: [col("Ideas"), col("Por reservar"), col("Reservado"), col("Antes de salir"), col("Durante el viaje"), col("Hecho", true)],
      kinds: [
        kind("Transporte", "#0ea5e9", "Transporte: ", "**Trayecto y fechas:**\n\n**Compañía y referencia de reserva:**\n\n**Horarios:**\n", ["Comparar precios", "Reservar", "Guardar los billetes"]),
        kind("Alojamiento", "#6366f1", "Alojamiento: ", "**Lugar y fechas:**\n\n**Dirección y contacto:**\n\n**Condiciones de cancelación:**\n", ["Comparar opciones", "Reservar", "Confirmar la hora de llegada"]),
        kind("Actividad", "#ec4899", "Actividad: ", "**Qué y dónde:**\n\n**Día y hora:**\n\n**Precio y reserva:**\n", ["Comprobar horarios y precios", "Reservar entradas"]),
        kind("Documentación", "#64748b", "Documentación: ", "**Qué documento:**\n\n**Quién lo necesita:**\n\n**Caducidad o plazo:**\n", ["Comprobar la vigencia", "Tramitarlo si hace falta", "Guardar copia digital"]),
        kind("Maleta", "#14b8a6", "Maleta: ", "**Para quién:**\n\n**Clima previsto:**\n\n**No olvidar:**\n\n- \n", ["Hacer la lista", "Preparar la maleta", "Revisar cargadores y documentos"]),
        kind("Presupuesto", "#eab308", "", "**Concepto e importe:**\n\n**Pagado / pendiente:**\n"),
      ],
      hiddenGeneralKinds: [],
      hideAllGeneralKinds: true,
      labels: [
        { name: "Imprescindible", color: "#ef4444" },
        { name: "Opcional", color: "#64748b" },
        { name: "Cancelación gratuita", color: "#22c55e" },
        { name: "Pendiente de pago", color: "#eab308" },
        { name: "Pagado", color: "#166534" },
      ],
    },
  },
  {
    key: "estudios-tesis",
    data: {
      name: "Estudios o tesis",
      description: "Trabajos largos de estudio o investigación: lecturas, redacción por capítulos, revisiones con el tutor y entrega.",
      columns: [col("Pendiente"), col("Investigando"), col("Redactando"), col("Revisión del tutor"), col("Corrigiendo"), col("Entregado", true)],
      kinds: [
        kind("Lectura", "#0ea5e9", "Leer: ", "**Fuente:**\n\n**Para qué capítulo:**\n\n**Ideas principales:**\n\n**Citas útiles:**\n", ["Leer", "Resumir", "Añadir a la bibliografía"]),
        kind("Redacción", "#6366f1", "Redactar: ", "**Capítulo o apartado:**\n\n**Esquema:**\n\n- \n\n**Extensión prevista:**\n", ["Esquema", "Primer borrador", "Revisar el estilo", "Comprobar las citas"]),
        kind("Trabajo de campo", "#22c55e", "Campo: ", "**Objetivo:**\n\n**Método:**\n\n**Datos a recoger:**\n\n**Fechas:**\n", ["Preparar el material", "Recoger los datos", "Ordenar y guardar copia"]),
        kind("Reunión con el tutor", "#a855f7", "Tutoría: ", "**Fecha:**\n\n**Qué hay que presentar:**\n\n**Dudas:**\n\n**Acuerdos:**\n", ["Enviar el material antes", "Preparar las dudas", "Anotar los acuerdos"]),
        kind("Bibliografía", "#8b5a2b", "", "**Referencias a añadir o comprobar:**\n\n- \n\n**Formato de cita:**\n"),
        kind("Entrega o defensa", "#ef4444", "Entrega: ", "**Qué se entrega y dónde:**\n\n**Fecha límite:**\n\n**Requisitos de formato:**\n", ["Revisión final del texto", "Comprobar el formato", "Entregar y guardar el justificante", "Preparar la presentación"]),
      ],
      hiddenGeneralKinds: [],
      hideAllGeneralKinds: true,
      labels: [
        { name: "Capítulo 1", color: "#0ea5e9" },
        { name: "Capítulo 2", color: "#6366f1" },
        { name: "Capítulo 3", color: "#a855f7" },
        { name: "Con el tutor", color: "#f97316" },
        { name: "Urgente", color: "#ef4444" },
      ],
    },
  },
  {
    key: "mudanza",
    data: {
      name: "Mudanza",
      description: "Cambio de casa sin olvidos: trámites, embalaje, transporte, limpieza y puesta a punto de la vivienda nueva.",
      columns: [col("Por hacer"), col("Esta semana"), col("Esperando"), col("Hecho", true)],
      kinds: [
        kind("Trámites y cambios de dirección", "#64748b", "Cambiar dirección: ", "**Organismo o empresa:**\n\n**Documentos necesarios:**\n\n**Fecha límite:**\n", ["Reunir documentos", "Hacer el cambio", "Guardar el justificante"]),
        kind("Embalaje", "#8b5a2b", "Embalar: ", "**Estancia:**\n\n**Qué se embala:**\n\n**Frágil o valioso:**\n", ["Conseguir cajas y material", "Embalar y etiquetar", "Anotar el contenido de las cajas"]),
        kind("Transporte", "#0ea5e9", "Transporte: ", "**Empresa o ayudantes:** [nombre]\n\n**Fecha y hora:**\n\n**Volumen aproximado:**\n\n**Accesos en origen y destino:**\n", ["Pedir presupuestos", "Reservar la fecha", "Reservar plaza de aparcamiento o permiso", "Confirmar el día anterior"]),
        kind("Limpieza y entrega de llaves", "#14b8a6", "", "**Vivienda:**\n\n**Qué hay que dejar hecho:**\n\n**Fecha de entrega de llaves:**\n", ["Limpiar a fondo", "Hacer fotos del estado", "Leer contadores", "Entregar las llaves"]),
        kind("Suministros", "#eab308", "Suministros: ", "**Servicio (luz, agua, internet…):**\n\n**Baja o alta:**\n\n**Fecha de cambio:**\n", ["Dar de baja en la casa anterior", "Dar de alta en la nueva", "Comprobar que funciona"]),
        kind("Casa nueva", "#ec4899", "", "**Qué hay que comprar o montar:**\n\n**Estancia:**\n\n**Medidas:**\n"),
      ],
      hiddenGeneralKinds: [],
      hideAllGeneralKinds: true,
      labels: [
        { name: "Cocina", color: "#f97316" },
        { name: "Salón", color: "#0ea5e9" },
        { name: "Dormitorios", color: "#a855f7" },
        { name: "Baño", color: "#14b8a6" },
        { name: "Urgente", color: "#ef4444" },
        { name: "Frágil", color: "#eab308" },
      ],
    },
  },
];

export const BUILTIN_KEYS = BUILTIN_TEMPLATES.map((b) => b.key);

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
  });
}

/** ¿La plantilla guardada difiere de la definición canónica de su `builtinKey`? Sin clave conocida, nunca. */
export function isBuiltinModified(stored: TemplateData, key: string | null | undefined): boolean {
  const canon = key ? canonicalTemplate(key) : null;
  return canon ? comparable(stored) !== comparable(canon) : false;
}
