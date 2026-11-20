"use client";

import { useMemo, useState } from "react";
import { getProjectFormData } from "@/actions/tasks";
import { BoardContext } from "@/components/board/context";
import { stubBoard } from "@/components/board/stubBoard";
import { lazyDialog } from "@/components/lazyDialog";
import { PairLeftWidthContext } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import { useT } from "@/i18n/client";
import { actionThrowMessage } from "@/lib/stale-action";
import type { DocumentKindName } from "@/lib/document-kind";
import type { EditorModeValue, ProjectFormData } from "@/lib/types";

// Los diálogos (con el editor de texto y el Markdown) no van en el código inicial de la Documentación: se piden al pulsar
// el botón, a la vez que las opciones del proyecto.
const loadNewTaskDialog = () => import("@/components/board/NewTaskDialog");
const loadBulkTaskDialog = () => import("@/components/board/BulkTaskDialog");
const NewTaskDialog = lazyDialog(loadNewTaskDialog, (m) => m.NewTaskDialog);
const BulkTaskDialog = lazyDialog(loadBulkTaskDialog, (m) => m.BulkTaskDialog);

interface Opts {
  projectId: string;
  currentUserId: string;
  editorMode: EditorModeValue;
  doc: { id: string; name: string; kind?: DocumentKindName };
  /** Ancho normal del visor (para colocar la pareja). */
  viewerWidth: string;
}

/**
 * «Nueva tarea» y «Varias tareas» abiertos al lado de un visor de documentos, con el visor abierto (como la pareja
 * de diálogos del tablero). Devuelve los manejadores de los botones redondos, si hay un diálogo abierto y los diálogos.
 */
export function useDocTaskDialogs({ projectId, currentUserId, editorMode, doc, viewerWidth }: Opts) {
  const t = useT();
  const toast = useToast();
  const [second, setSecond] = useState<"new" | "bulk" | null>(null);
  const [form, setForm] = useState<ProjectFormData | null>(null);
  const [loading, setLoading] = useState(false);

  async function open(kind: "new" | "bulk") {
    if (loading) return;
    if (form) return setSecond(kind);
    // El código del diálogo llega mientras se piden las opciones (sin red espera; el fallo de la petición ya avisa).
    (kind === "new" ? loadNewTaskDialog : loadBulkTaskDialog)().catch(() => {});
    setLoading(true);
    try {
      const res = await getProjectFormData(projectId);
      if (!res.ok) return toast(res.error, "error");
      setForm(res.data);
      setSecond(kind);
    } catch (e) {
      toast(actionThrowMessage(e, t), "error");
    } finally {
      setLoading(false);
    }
  }

  const api = useMemo(() => (form ? stubBoard(form, currentUserId, editorMode) : null), [form, currentUserId, editorMode]);
  // Enlace al documento para la descripción de la tarea nueva (se abre en la documentación del proyecto).
  const link = typeof window === "undefined" ? "" : `[${doc.name.replace(/[[\]]/g, "")}](${window.location.origin}/p/${projectId}/docs?doc=${doc.id})`;

  const dialogs = api && second && (
    <BoardContext.Provider value={api}>
    <PairLeftWidthContext.Provider value={viewerWidth}>
      {second === "new" ? (
        <NewTaskDialog side="right" pickProject initialColumnId={api.columns[0]?.id} initialDescription={link} attachDocument={doc} onClose={() => setSecond(null)} />
      ) : (
        <BulkTaskDialog side="right" pickProject onClose={() => setSecond(null)} />
      )}
    </PairLeftWidthContext.Provider>
    </BoardContext.Provider>
  );

  return { open: second !== null, onAddSecond: () => void open("new"), onAddSecondBulk: () => void open("bulk"), dialogs };
}
