import { AuthCard } from "@/components/auth/AuthCard";
import { Markdown } from "@/components/ui/Markdown";
import { intlLocale } from "@/i18n/core";
import { getLocale, getT } from "@/i18n/server";
import { getLegalSettings } from "@/lib/legal";
import { defaultLegalMarkdown, fillLegalPlaceholders, pickLegalText } from "@/lib/legal-core";

/**
 * Política de privacidad o condiciones de una instalación de Pizarro (páginas públicas /privacy y /terms).
 * Muestra el texto que el administrador ha escrito en Administración → Textos legales (Markdown seguro) o, si no hay,
 * el genérico. En inglés sin texto inglés propio pero con texto español propio, gana el español del responsable.
 */
export async function LegalPage({ kind }: { kind: "privacy" | "terms" }) {
  const t = await getT();
  const locale = await getLocale();
  const s = await getLegalSettings();
  const picked = pickLegalText(s.texts[kind], locale);
  const raw = picked.source === "default" ? defaultLegalMarkdown(kind, locale) : picked.text;
  const body = fillLegalPlaceholders(raw, picked.locale, s.responsible, s.email);
  const updated = picked.source !== "default" && s.updatedAt[kind] ? new Date(s.updatedAt[kind]!) : null;
  return (
    <AuthCard wide title={kind === "privacy" ? t("Política de privacidad") : t("Condiciones del servicio")}>
      <div className="space-y-4 text-sm" data-testid={`legal-${kind}`}>
        <div lang={picked.locale}>
          <Markdown>{body}</Markdown>
        </div>
        {updated && !Number.isNaN(updated.getTime()) && (
          <p className="text-xs text-slate-500" data-testid="legal-updated">
            {t("Última actualización: {fecha}", { fecha: updated.toLocaleDateString(intlLocale(locale), { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }) })}
          </p>
        )}
        <p className="pt-2 text-xs"><a className="underline" href="/login">{t("Volver al acceso")}</a></p>
      </div>
    </AuthCard>
  );
}
