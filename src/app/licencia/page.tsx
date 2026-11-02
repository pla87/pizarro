import type { Metadata } from "next";
import { headers } from "next/headers";
import { AuthCard } from "@/components/auth/AuthCard";
import { Markdown } from "@/components/ui/Markdown";
import { I18nProvider } from "@/i18n/client";
import { makeT } from "@/i18n/core";
import { getLocale } from "@/i18n/server";
import { pickLandingLocale } from "@/lib/landing-locale";
import { LICENSE_EN, LICENSE_ES } from "@/lib/license-text";

// Página pública (sin sesión) con la licencia del software, igual que LICENSE.md. Idioma como la página de presentación:
// ?lang=, si no el del navegador y, si tampoco sirve, el de la instalación. El texto en español es el que prevalece.
export const dynamic = "force-dynamic";

type Search = Promise<{ lang?: string | string[] }>;

async function resolveLocale(searchParams: Search) {
  const sp = await searchParams;
  const lang = Array.isArray(sp.lang) ? sp.lang[0] : sp.lang;
  return pickLandingLocale({ lang, acceptLanguage: (await headers()).get("accept-language"), fallback: await getLocale() });
}

export async function generateMetadata({ searchParams }: { searchParams: Search }): Promise<Metadata> {
  const t = makeT(await resolveLocale(searchParams));
  return {
    title: t("Licencia de Pizarro"),
    description: t("Licencia de código disponible: gratis para uso personal y de pago único por servidor para empresas y profesionales."),
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
          <Markdown>{body}</Markdown>
          <p className="text-xs text-slate-500">
            <a className="underline" href={locale === "en" ? "/licencia?lang=es" : "/licencia?lang=en"}>{t("Ver la licencia en el otro idioma")}</a>
            {" · "}
            <a className="underline" href="/login">{t("Volver al acceso")}</a>
          </p>
        </div>
      </AuthCard>
    </I18nProvider>
  );
}
