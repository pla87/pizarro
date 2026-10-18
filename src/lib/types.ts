// Tipos serializables que viajan del servidor al cliente.
import type { ColumnRoleValue, TaskTypeValue } from "./constants";

export interface BoardColumn {
  id: string;
  name: string;
  position: number;
  role: ColumnRoleValue;
}

export interface BoardTask {
  id: string;
  columnId: string;
  title: string;
  type: TaskTypeValue;
  color: string | null;
  linkUrl: string | null;
  position: number;
  assigneeId: string | null;
  labelIds: string[];
  subtaskTotal: number;
  subtaskDone: number;
  attachmentCount: number;
  hasDescription: boolean;
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
  templates: { header: string; footer: string };
  currentUserId: string;
}

export interface AttachmentInfo {
  id: string;
  originalName: string;
  width: number;
  height: number;
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
}
