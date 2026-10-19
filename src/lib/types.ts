// Tipos serializables que viajan del servidor al cliente.
import type { ColumnRoleValue } from "./constants";

export interface BoardColumn {
  id: string;
  name: string;
  position: number;
  role: ColumnRoleValue;
  isDone: boolean;
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
  attachmentCount: number;
  hasDescription: boolean;
  /** YYYY-MM-DD */
  dueDate: string | null;
  deliverableId: string | null;
  commentCount: number;
  linkCount: number;
  /** Tarea fija en la columna de la release (no se mueve ni se archiva al desplegar). */
  evergreen: boolean;
}

export interface KindOption {
  id: string;
  name: string;
  color: string;
  /** Automatización al elegir el tipo (vacío = nada). */
  titleTemplate: string;
  descriptionTemplate: string;
  system: boolean;
}

export interface TemplateOption {
  id: string;
  name: string;
  content: string;
}

export type CardStyleValue = "STRIPE" | "FILLED";

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
  project: { id: string; name: string };
  columns: BoardColumn[];
  tasks: BoardTask[];
  users: UserOption[];
  labels: LabelOption[];
  kinds: KindOption[];
  templates: { headers: TemplateOption[]; footers: TemplateOption[] };
  cardStyle: CardStyleValue;
  currentUserId: string;
  deliverables: DeliverableOption[];
  google: { enabled: boolean; connected: boolean };
  /** Hoy (YYYY-MM-DD) en la zona horaria de la app, para los avisos de plazo. */
  today: string;
}

export interface TaskLinkInfo {
  id: string;
  kind: "GOOGLE_DOC" | "GOOGLE_SHEET";
  title: string;
  url: string;
}

export interface CommentInfo {
  id: string;
  body: string;
  createdAt: string;
  authorId: string | null;
  authorName: string | null;
}

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
  comments: CommentInfo[];
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
