"use client";

import { ClipboardCopy, Loader2 } from "lucide-react";
import { useTransition } from "react";
import { getTechInfo } from "@/actions/tech-info";
import { copyText } from "@/components/ui/clipboard";
import { useToast } from "@/components/ui/Toast";
import { useT } from "@/i18n/client";
import { actionThrowResult } from "@/lib/stale-action";

/** «Copiar información técnica»: unas líneas para pegar en una incidencia (versión, commit, Node, base de datos…). */
export function TechInfoButton() {
  const t = useT();
  const toast = useToast();
  const [pending, start] = useTransition();
  const copy = () =>
    start(async () => {
      const res = await getTechInfo().catch((e) => actionThrowResult(e, t));
      if (!res.ok) return toast(res.error, "error");
      if (await copyText(res.data)) toast(t("Información técnica copiada. Revísala antes de pegarla en una incidencia."), "success");
      else toast(t("No se pudo copiar"), "error");
    });
  return (
    <button type="button" className="btn-secondary w-fit py-1.5" onClick={copy} disabled={pending}>
      {pending ? <Loader2 size={15} className="animate-spin" /> : <ClipboardCopy size={15} />} {t("Copiar información técnica")}
    </button>
  );
}
