import type { Metadata } from "next";
import { headers } from "next/headers";
import { AuthCard } from "@/components/auth/AuthCard";
import { StaticMarkdown } from "@/components/ui/StaticMarkdown";
import { I18nProvider } from "@/i18n/client";
import { makeT } from "@/i18n/core";
import { getLocale } from "@/i18n/server";
import { pickLandingLocale } from "@/lib/landing-locale";
import { LICENSE_EN, LICENSE_ES } from "@/lib/license-text";
import { SITE_URL } from "@/lib/product";
import { getCurrentUser } from "@/lib/session";

// Página pública (sin sesión) con la licencia del software, igual que LICENSE.md. Idioma como la página de presentación:
// ?lang=, si no el del navegador y, si tampoco sirve, el de la instalación. El texto en español es el que prevalece.
export const dynamic = "force-dynamic";

type Search = Promise<{ lang?: string | string[] }>;

async function resolveLocale(searchParams: Search) {
  const sp = await searchParams;
  const lang = Array.isArray(sp.lang) ? sp.lang[0] : sp.lang;
  // Con sesión manda el idioma de la persona (como en la presentación); sin ella, el del navegador.
  const user = await getCurrentUser().catch(() => null);
  const acceptLanguage = user ? null : (await headers()).get("accept-language");
  return pickLandingLocale({ lang, acceptLanguage, fallback: await getLocale() });
}

export async function generateMetadata({ searchParams }: { searchParams: Search }): Promise<Metadata> {
  const t = makeT(await resolveLocale(searchParams));
  return {
    title: t("Licencia de Pizarro"),
    description: t("Licencia de código disponible: gratis para uso personal y educativo, y de pago único por servidor para empresas y profesionales."),
    robots: { index: true, follow: true },
  };
}

export default async function Page({ searchParams }: { searchParams: Search }) {
  const locale = await resolveLocale(searchParams);
  const t = makeT(locale);
  // El título de la tarjeta ya es el de la licencia: se quita el encabezado repetido del Markdown.
  const body = (locale === "en" ? LICENSE_EN : LICENSE_ES).replace(/^# .*\n+/, "");
  return (
    <I18nProvider locale={locale}>
      <AuthCard wide title={t("Licencia de Pizarro")}>
        <div className="space-y-4 text-sm" data-testid="license" lang={locale}>
          <StaticMarkdown t={t}>{body}</StaticMarkdown>
          <p className="text-xs text-slate-500">
            <a className="underline" href={locale === "en" ? "/licencia?lang=es" : "/licencia?lang=en"}>{t("Ver la licencia en el otro idioma")}</a>
            {" · "}
            <a className="underline" href={locale === "en" ? `${SITE_URL}/en/#pricing` : `${SITE_URL}/#precios`} rel="noopener noreferrer" data-testid="license-site">{t("Precio y compra en getpizarro.com")}</a>
            {" · "}
            <a className="underline" href="/login">{t("Volver al acceso")}</a>
          </p>
        </div>
      </AuthCard>
    </I18nProvider>
  );
}
