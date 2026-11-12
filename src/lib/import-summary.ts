// Texto del resumen de una importación (cliente y pruebas): sin dependencias del servidor.
import type { T } from "@/i18n/shared";

/** Recuentos del resumen que se muestran (los de Trello y CSV no traen adjuntos, releases ni documentos). */
interface ImportCounts {
  columns: number;
  tasks: number;
  archivedTasks: number;
  subtasks?: number;
  labels?: number;
  comments: number;
  taskAttachments: number;
  releaseAttachments: number;
  releases: number;
  documents: number;
}

/**
 * Qué se ha importado, con cada número en singular o plural («1 comentario», no «1 comentarios») y unido como una lista
 * del idioma («a, b y c»). Columnas y tareas siempre; lo demás, solo si hay alguno.
 */
export function importSummaryItems(c: ImportCounts, foreign: boolean, t: T, locale: string): string {
  const n = (count: number, one: string, many: string) => (count === 1 ? one : many);
  const tasks = foreign ? n(c.tasks, t("1 tarea"), t("{n} tareas", { n: c.tasks })) : n(c.tasks, t("1 tarjeta"), t("{n} tarjetas", { n: c.tasks }));
  const archived = c.archivedTasks ? ` ${n(c.archivedTasks, t("(1 archivada)"), t("({n} archivadas)", { n: c.archivedTasks }))}` : "";
  const columns = n(c.columns, t("1 columna"), t("{n} columnas", { n: c.columns }));
  const comments = c.comments ? n(c.comments, t("1 comentario"), t("{n} comentarios", { n: c.comments })) : null;
  const attachments = c.taskAttachments + c.releaseAttachments;
  const items = foreign
    ? [
        columns, `${tasks}${archived}`,
        c.subtasks ? n(c.subtasks, t("1 subtarea"), t("{n} subtareas", { n: c.subtasks })) : null,
        c.labels ? n(c.labels, t("1 etiqueta"), t("{n} etiquetas", { n: c.labels })) : null,
        comments,
      ]
    : [
        `${tasks}${archived}`, columns, comments,
        attachments ? n(attachments, t("1 adjunto"), t("{n} adjuntos", { n: attachments })) : null,
        c.releases ? n(c.releases, t("1 release"), t("{n} releases", { n: c.releases })) : null,
        c.documents ? n(c.documents, t("1 documento"), t("{n} documentos", { n: c.documents })) : null,
      ];
  return new Intl.ListFormat(locale, { type: "conjunction" }).format(items.filter((x): x is string => !!x));
}
