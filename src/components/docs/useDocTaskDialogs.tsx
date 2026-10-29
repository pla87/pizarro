"use client";

import { useMemo, useState } from "react";
import { getProjectFormData } from "@/actions/tasks";
import { BoardContext, type BoardApi } from "@/components/board/context";
import { createBoardStores } from "@/components/board/stores";
import { BulkTaskDialog } from "@/components/board/BulkTaskDialog";
import { NewTaskDialog } from "@/components/board/NewTaskDialog";
import { useToast } from "@/components/ui/Toast";
import { useT } from "@/i18n/client";
import { actionThrowMessage } from "@/lib/stale-action";
import type { EditorModeValue, ProjectFormData } from "@/lib/types";

interface Opts {
  projectId: string;
  currentUserId: string;
  editorMode: EditorModeValue;
  doc: { id: string; name: string };
}

/** Un «tablero» mínimo para los diálogos de tareas fuera del tablero: las opciones del proyecto y nada de tarjetas. */
function stubBoard(form: ProjectFormData, currentUserId: string, editorMode: EditorModeValue): BoardApi {
  const noop = () => {};
  const passthrough = <T,>(p: Promise<T>) => p;
  const stores = createBoardStores([]);
  return {
    project: form.project,
    users: form.users,
    currentUserId,
    columns: form.columns,
    labels: form.labels,
    deliverables: form.deliverables,
    kinds: form.kinds,
    kindById: new Map(form.kinds.map((k) => [k.id, k])),
    cardStyle: "STRIPE",
    editorMode,
    dragHandle: false,
    google: { enabled: false, connected: false },
    today: "",
    stores,
    getTask: () => undefined,
    getTasks: () => [],
    upsertTask: noop,
    patchTask: noop,
    removeTask: noop,
    revealTask: noop,
    track: passthrough,
    trackRaw: passthrough,
    settle: async () => {},
    refresh: noop,
  } as unknown as BoardApi;
}

/**
 * «Nueva tarea» y «Varias tareas» abiertos al lado de un visor de documentos, con el visor abierto (como la pareja
 * de diálogos del tablero). Devuelve los manejadores de los botones redondos, si hay un diálogo abierto y los diálogos.
 */
export function useDocTaskDialogs({ projectId, currentUserId, editorMode, doc }: Opts) {
  const t = useT();
  const toast = useToast();
  const [second, setSecond] = useState<"new" | "bulk" | null>(null);
  const [form, setForm] = useState<ProjectFormData | null>(null);
  const [loading, setLoading] = useState(false);

  async function open(kind: "new" | "bulk") {
    if (loading) return;
    if (form) return setSecond(kind);
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
      {second === "new" ? (
        <NewTaskDialog side="right" pickProject initialColumnId={api.columns[0]?.id} initialDescription={link} onClose={() => setSecond(null)} />
      ) : (
        <BulkTaskDialog side="right" pickProject onClose={() => setSecond(null)} />
      )}
    </BoardContext.Provider>
  );

  return { open: second !== null, onAddSecond: () => void open("new"), onAddSecondBulk: () => void open("bulk"), dialogs };
}
