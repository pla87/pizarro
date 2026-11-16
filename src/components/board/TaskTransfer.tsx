"use client";

// Exportar e importar varias tareas en JSON desde el tablero (formato en lib/task-json.ts). En la cabecera, junto a
// «Varias tareas», un botón que sin selección es «Importar» (abre ImportTasksDialog) y con tarjetas marcadas con la
// casilla pasa a «Exportar (N)»: descargar un .json o copiarlo. La barra de selección (la que se ve en el móvil y la
// tableta, donde la cabecera se reduce) lleva también «Exportar».
import { ClipboardCopy, Download, Import } from "lucide-react";
import { useRef } from "react";
import { exportTasksJson } from "@/actions/task-json";
import { useT } from "@/i18n/client";
import { actionThrowResult } from "@/lib/stale-action";
import { isOfflineMessage } from "@/lib/connection";
import { copyText, downloadText } from "../ui/clipboard";
import { Menu, MenuItem } from "../ui/Menu";
import { useToast } from "../ui/Toast";
import { useBoard, useSelectionSize } from "./context";
import { copyTextLater } from "./taskClipboard";
import { HEADER_LABEL } from "./useHeaderFit";

/** Pide al servidor el JSON de las tarjetas marcadas (en el orden del tablero) y lo descarga o lo copia. */
function useExportSelected() {
  const board = useBoard();
  const t = useT();
  const toast = useToast();
  const busy = useRef(false);
  const fetchJson = () => {
    const ids = [...board.getSelected()];
    return board.track(exportTasksJson(board.project.id, ids)).catch((e) => actionThrowResult(e, t));
  };
  const fail = (error: string) => {
    // Sin conexión ya lo ha avisado board.track.
    if (!isOfflineMessage(error, t)) toast(error, "error");
  };
  const download = async () => {
    if (busy.current) return;
    busy.current = true;
    try {
      const res = await fetchJson();
      if (!res.ok) return fail(res.error);
      downloadText(res.data.text, res.data.fileName, "application/json");
      toast(res.data.count === 1 ? t("1 tarea exportada") : t("{n} tareas exportadas", { n: res.data.count }));
    } finally {
      busy.current = false;
    }
  };
  const copy = async () => {
    if (busy.current) return;
    busy.current = true;
    try {
      let error: string | null = null;
      let count = 0;
      // Safari solo deja escribir en el portapapeles dentro del clic: se le entrega ya la promesa del texto.
      const text = fetchJson().then((res) => {
        if (res.ok) {
          count = res.data.count;
          return res.data.text;
        }
        error = res.error;
        throw new Error(res.error);
      });
      text.catch(() => undefined);
      const ok = await copyTextLater(text, copyText).catch(() => false);
      if (error !== null) return fail(error);
      if (ok) toast(count === 1 ? t("1 tarea copiada como JSON") : t("{n} tareas copiadas como JSON", { n: count }));
      else toast(t("No se ha podido copiar al portapapeles."), "error");
    } finally {
      busy.current = false;
    }
  };
  return { download, copy };
}

/** Menú «Exportar»: descargar el .json o copiarlo. `trigger` dibuja el botón (cabecera o barra de selección). */
export function ExportMenu({ trigger, align = "end", className }: { trigger: (props: object) => React.ReactNode; align?: "start" | "end"; className?: string }) {
  const t = useT();
  const { download, copy } = useExportSelected();
  return (
    <Menu
      align={align}
      label={t("Exportar tareas")}
      className={className ?? "relative shrink-0"}
      panelClassName="w-56 rounded-lg border border-slate-200 bg-white p-1 text-sm shadow-lg dark:border-slate-700 dark:bg-slate-900"
      trigger={({ props }) => trigger(props)}
    >
      <MenuItem icon={Download} onClick={() => void download()}>{t("Descargar .json")}</MenuItem>
      <MenuItem icon={ClipboardCopy} onClick={() => void copy()}>{t("Copiar")}</MenuItem>
    </Menu>
  );
}

/** Botón de la cabecera: «Importar» sin selección; «Exportar (N)» con tarjetas marcadas. Se suscribe solo al contador. */
export function TransferButton({ onImport }: { onImport: () => void }) {
  const t = useT();
  const count = useSelectionSize();
  if (count === 0) {
    return (
      <button className="btn-secondary" onClick={onImport} aria-label={t("Importar")} title={t("Importar tareas desde JSON")} data-transfer="import">
        <Import size={16} /> <span className={HEADER_LABEL}>{t("Importar")}</span>
      </button>
    );
  }
  const label = t("Exportar ({n})", { n: count });
  return (
    <ExportMenu
      trigger={(props) => (
        <button type="button" className="btn-secondary" aria-label={label} title={t("Exportar las tareas seleccionadas a JSON")} data-transfer="export" {...props}>
          <Download size={16} /> <span className={HEADER_LABEL}>{label}</span>
        </button>
      )}
    />
  );
}
