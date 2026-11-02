import type { Metadata } from "next";
import { headers } from "next/headers";
import { Landing } from "@/components/landing/Landing";
import { I18nProvider } from "@/i18n/client";
import { makeT } from "@/i18n/core";
import { getLocale } from "@/i18n/server";
import { getPublicContactEmail } from "@/lib/google-config";
import { pickLandingLocale } from "@/lib/landing-locale";
import { getCurrentUser } from "@/lib/session";

// Página pública de presentación (sin sesión): se sirve en /presentacion y, con LANDING_AT_ROOT=1, en «/» a quien no ha iniciado sesión.
// Español por defecto; inglés si lo pide el navegador (o con ?lang=en). Sin rastreadores ni recursos externos.
export const dynamic = "force-dynamic";

type Search = Promise<{ lang?: string | string[] }>;

async function resolveLocale(searchParams: Search) {
  const sp = await searchParams;
  const lang = Array.isArray(sp.lang) ? sp.lang[0] : sp.lang;
  const user = await getCurrentUser().catch(() => null);
  // Con sesión manda el idioma de la persona; sin ella, el del navegador y, por último, el de la instalación.
  const acceptLanguage = user ? null : (await headers()).get("accept-language");
  return pickLandingLocale({ lang, acceptLanguage, fallback: await getLocale() });
}

export async function generateMetadata({ searchParams }: { searchParams: Search }): Promise<Metadata> {
  const t = makeT(await resolveLocale(searchParams));
  return {
    title: t("Pizarro: Kanban y release notes en tu propio servidor"),
    description: t("Tablero Kanban con notas de release generadas y documentación del proyecto. Autoalojado, privado y sin cuota por usuario."),
    robots: { index: true, follow: true },
  };
}

export default async function Page({ searchParams }: { searchParams: Search }) {
  const locale = await resolveLocale(searchParams);
  const contactEmail = await getPublicContactEmail().catch(() => "");
  return (
    <I18nProvider locale={locale}>
      <div lang={locale}>
        <Landing t={makeT(locale)} locale={locale} contactEmail={contactEmail} />
      </div>
    </I18nProvider>
  );
}
