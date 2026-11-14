"use client";

import { ReleaseTemplateList } from "@/components/ReleaseTemplateList";
import { useLocale, useT } from "@/i18n/client";
import { AI_PLAN_DEFAULTS } from "@/lib/ai-plan";
import type { EditorModeValue, TemplateOption } from "@/lib/types";

type Actions = Parameters<typeof ReleaseTemplateList>[0]["actions"];

/**
 * Cabeceras y pies del plan de trabajo para IA (Mi perfil → Plantillas y Ajustes del proyecto → Plantillas): las mismas
 * listas que las de release, con los tipos del plan. Una nueva empieza con el texto de serie (para Claude Code), que es
 * el que usa el plan mientras no haya ninguna propia.
 */
export function PlanTemplateLists({ editorMode, actions, initial, showDefault = true }: {
  editorMode: EditorModeValue;
  actions: Actions;
  initial: { headers: TemplateOption[]; footers: TemplateOption[] };
  showDefault?: boolean;
}) {
  const t = useT();
  const builtin = AI_PLAN_DEFAULTS[useLocale() === "en" ? "en" : "es"];
  return (
    <>
      <ReleaseTemplateList
        editorMode={editorMode}
        actions={actions}
        showDefault={showDefault}
        kind="PLAN_HEADER"
        title={t("Cabeceras del plan")}
        initial={initial.headers}
        starter={{ name: t("Instrucciones para la IA"), content: builtin.header }}
        placeholder={t("Instrucciones generales para la IA: cómo trabajar, qué comprobar, qué no hacer.")}
      />
      <ReleaseTemplateList
        editorMode={editorMode}
        actions={actions}
        showDefault={showDefault}
        kind="PLAN_FOOTER"
        title={t("Pies del plan")}
        initial={initial.footers}
        starter={{ name: t("Entrega"), content: builtin.footer }}
        placeholder={t("Instrucciones de entrega: qué debe contar la IA al terminar.")}
      />
    </>
  );
}
