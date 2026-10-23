// Plantillas de proyecto incluidas de serie. La definición canónica vive aquí; en la base de datos cada
// una es una fila normal de ProjectTemplate con su `builtinKey`, que el administrador puede editar o borrar.
import { templateInputSchema, type TemplateData, type TemplateInput } from "./project-templates";

type Col = TemplateInput["columns"][number];
type Kind = NonNullable<TemplateInput["kinds"]>[number];

const col = (name: string, isDone = false, role: Col["role"] = "NONE"): Col => ({ name, role, isDone });
const kind = (name: string, color: string, titleTemplate: string, descriptionTemplate: string, subtaskTemplate: string[] = []): Kind => ({
  name,
  color,
  titleTemplate,
  descriptionTemplate,
  subtaskTemplate,
});

/** Tipos generales de software que las plantillas ajenas al software no usan. */
const GENERALES_SOFTWARE = ["Funcionalidad", "Corrección"];

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
      labels: [
        { name: "Urgente", color: "#ef4444" },
        { name: "Pendiente de pago", color: "#eab308" },
        { name: "Esperando respuesta", color: "#64748b" },
        { name: "Confirmado", color: "#22c55e" },
        { name: "Día del evento", color: "#a855f7" },
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

/** Forma comparable: campos en orden fijo, sin id ni posición. */
function comparable(t: TemplateData): string {
  return JSON.stringify({
    name: t.name,
    description: t.description,
    columns: t.columns.map((c) => [c.name, c.role, c.isDone]),
    kinds: t.kinds.map((k) => [k.name, k.color, k.titleTemplate, k.descriptionTemplate, k.subtaskTemplate]),
    hidden: t.hiddenGeneralKinds,
    labels: t.labels.map((l) => [l.name, l.color]),
  });
}

/** ¿La plantilla guardada difiere de la definición canónica de su `builtinKey`? Sin clave conocida, nunca. */
export function isBuiltinModified(stored: TemplateData, key: string | null | undefined): boolean {
  const canon = key ? canonicalTemplate(key) : null;
  return canon ? comparable(stored) !== comparable(canon) : false;
}
