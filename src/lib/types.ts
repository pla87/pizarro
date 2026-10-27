// Tipos serializables que viajan del servidor al cliente.
import type { ColumnRoleValue } from "./constants";

export interface BoardColumn {
  id: string;
  name: string;
  position: number;
  role: ColumnRoleValue;
  isDone: boolean;
  /** Solo rol WAITING: días hasta el recordatorio (null = por defecto). */
  waitingDays: number | null;
}

export interface BoardTask {
  id: string;
  columnId: string;
  title: string;
  kindId: string;
  color: string | null;
  linkUrl: string | null;
  position: number;
  assigneeId: string | null;
  labelIds: string[];
  subtaskTotal: number;
  subtaskDone: number;
  /** Adjuntos que son imágenes y adjuntos que son otros ficheros (la tarjeta muestra ambos contadores). */
  imageCount: number;
  fileCount: number;
  /** Suma de los tamaños de todos los adjuntos de la tarea (bytes). */
  attachBytes: number;
  hasDescription: boolean;
  /** YYYY-MM-DD */
  dueDate: string | null;
  deliverableId: string | null;
  commentCount: number;
  linkCount: number;
  /** Tarea fija en la columna de la release (no se mueve ni se archiva al desplegar). */
  evergreen: boolean;
  /** Cadencia de una tarea fija: 1 = todas las releases, 2 = las pares, 3 = múltiplos de 3. */
  evergreenEvery: number;
  /** Repetición: al terminarse o archivarse nace la siguiente aparición. */
  recurrence: "NONE" | "DAILY" | "WEEKLY" | "MONTHLY";
  /** Semanal: 1 (lunes) a 7 (domingo). Mensual: día del mes. */
  recurrenceDay: number | null;
  /** Última edición del título/descripción (para detectar ediciones simultáneas). */
  textVersion: string | null;
  /** Cuándo entró en su columna actual (ISO): la tarjeta de una columna «Esperando» muestra los días. */
  columnEnteredAt: string;
}

export interface KindOption {
  id: string;
  name: string;
  color: string;
  /** Automatización al elegir el tipo (vacío = nada). */
  titleTemplate: string;
  descriptionTemplate: string;
  /** Subtareas que se añaden al elegir el tipo al crear una tarea. */
  subtaskTemplate: string[];
}

export interface TemplateOption {
  id: string;
  name: string;
  content: string;
}

export type CardStyleValue = "STRIPE" | "FILLED";
export type EditorModeValue = "MARKDOWN" | "WYSIWYG";

export interface DeliverableOption {
  id: string;
  name: string;
  dueDate: string | null;
}

export interface UserOption {
  id: string;
  name: string;
}

export interface LabelOption {
  id: string;
  name: string;
  color: string;
}

export interface BoardData {
  /** `attachMaxMb`: tope de adjuntos por tarea (y por paquete de release) del proyecto; `fileMaxMb`: tope por archivo. */
  project: { id: string; name: string; attachMaxMb: number; fileMaxMb: number };
  columns: BoardColumn[];
  tasks: BoardTask[];
  users: UserOption[];
  labels: LabelOption[];
  kinds: KindOption[];
  templates: { headers: TemplateOption[]; footers: TemplateOption[] };
  cardStyle: CardStyleValue;
  /** Cómo edita descripciones el usuario actual. */
  editorMode: EditorModeValue;
  currentUserId: string;
  deliverables: DeliverableOption[];
  google: { enabled: boolean; connected: boolean };
  /** Hoy (YYYY-MM-DD) en la zona horaria de la app, para los avisos de plazo. */
  today: string;
}

/** Opciones de un proyecto para el diálogo «Nueva tarea» cuando se crea en un proyecto distinto del abierto. */
export interface ProjectFormData {
  project: BoardData["project"];
  columns: BoardColumn[];
  users: UserOption[];
  kinds: KindOption[];
  deliverables: DeliverableOption[];
  /** Etiquetas del proyecto (para crear varias tareas en otro proyecto). */
  labels: LabelOption[];
}

export interface TaskLinkInfo {
  id: string;
  kind: "GOOGLE_DOC" | "GOOGLE_SHEET";
  title: string;
  url: string;
  /** Resultado de compartir al crearlo: SHARED, PARTIAL, NOT_SHARED o null (anterior a este registro). */
  shareStatus: string | null;
  /** Con PARTIAL, a cuántas personas no se pudo compartir. */
  shareFailed: number;
}

export interface CommentInfo {
  id: string;
  body: string;
  createdAt: string;
  authorId: string | null;
  authorName: string | null;
  /** Comentario raíz al que responde (null = comentario de primer nivel). */
  parentId: string | null;
  /** Borrado pero conservado (tenía respuestas): sin texto, se muestra como «Comentario borrado». */
  deleted?: boolean;
}

/** Contadores de adjuntos de una tarea (los de la tarjeta): se calculan siempre sobre las filas que existen. */
export interface AttachmentTotals {
  imageCount: number;
  fileCount: number;
  attachBytes: number;
}

/** Respuesta de la subida: el adjunto y los contadores reales de la tarea tras crearlo. */
export type UploadedAttachment = AttachmentInfo & { totals: AttachmentTotals };

export interface AttachmentInfo {
  id: string;
  originalName: string;
  mimeType: string;
  isImage: boolean;
  /** Bytes guardados. */
  size: number;
  width: number | null;
  height: number | null;
}

export interface SubtaskInfo {
  id: string;
  title: string;
  done: boolean;
  position: number;
}

export interface TaskDetail {
  id: string;
  description: string;
  createdAt: string;
  createdByName: string | null;
  subtasks: SubtaskInfo[];
  attachments: AttachmentInfo[];
  links: TaskLinkInfo[];
  /** Los más recientes (ver COMMENTS_PAGE); los anteriores se piden con getOlderComments. */
  comments: CommentInfo[];
  /** Comentarios (filas) más antiguos que los cargados. */
  olderComments: number;
  /** Comentarios vivos de la tarea (sin los borrados que conservan respuestas). */
  commentCount: number;
  /** Versión del título/descripción cargados (ver BoardTask.textVersion). */
  textVersion: string | null;
  /** El usuario actual sigue la tarea (recibe avisos de comentarios y cambios). */
  following: boolean;
}

/** Tarea archivada, con su columna de origen y las releases en las que entró. */
export interface ArchivedTask {
  id: string;
  title: string;
  kindId: string;
  archivedAt: string;
  /** Nombre de la columna de la que salió; null si ya no existe. */
  columnName: string | null;
  releases: { id: string; title: string; deployedAt: string }[];
}
