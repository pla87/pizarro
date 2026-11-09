import Link from "next/link";
import { ArrowRight, Check, Mail, Users, Wallet, Lock, Sparkles } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { Locale, T } from "@/i18n/core";
import { BrandMark } from "@/components/ui/BrandMark";
import { landingFaq, landingHero, landingIncludes, landingPillars, landingSteps, type PillarKey } from "@/lib/landing-content";
import { buyHref, buyNote, INSTALL_URL, LICENSE_PRICE_EUR, REPO_URL, SITE_URL } from "@/lib/product";

const PILLAR_ICONS: Record<PillarKey, LucideIcon> = { simple: Sparkles, once: Wallet, data: Lock, small: Users };

function SectionTitle({ id, title }: { id: string; title: string }) {
  return (
    <div className="mb-8 max-w-2xl">
      <h2 id={id} className="scroll-mt-20 text-2xl font-bold tracking-tight sm:text-3xl">{title}</h2>
    </div>
  );
}

export function Landing({ t, locale, contactEmail }: { t: T; locale: Locale; contactEmail: string }) {
  const other = locale === "es" ? "en" : "es";
  const buy = buyHref(contactEmail, locale);
  const buyExternal = /^https?:\/\//.test(buy);

  const hero = landingHero(t);
  const pillars = landingPillars(t);
  const includes = landingIncludes(t);
  const steps = landingSteps(t);
  const faq = landingFaq(t);

  return (
    <div data-testid="landing">
      <header className="sticky top-0 z-40 border-b border-slate-200 bg-slate-50/90 backdrop-blur dark:border-slate-800 dark:bg-slate-950/90">
        <div className="mx-auto flex max-w-5xl items-center gap-3 px-4 py-2.5">
          <Link href="/presentacion" className="mr-auto flex items-center gap-2 font-bold tracking-tight">
            <BrandMark size={28} /> Pizarro
          </Link>
          <a href={`?lang=${other}`} hrefLang={other} lang={other} className="btn-ghost px-2" data-testid="landing-lang" aria-label={other === "en" ? "English" : "Español"}>{other.toUpperCase()}</a>
          <Link href="/login" className="btn-secondary whitespace-nowrap">{t("Iniciar sesión")}</Link>
        </div>
      </header>

      <main>
        <section className="mx-auto max-w-5xl px-4 pt-14 pb-14 sm:pt-24 sm:pb-20">
          <h1 className="max-w-3xl text-4xl font-bold tracking-tight text-balance sm:text-5xl">{hero.title}</h1>
          <p className="mt-4 max-w-2xl text-lg text-slate-600 dark:text-slate-400">
            {hero.lead}
          </p>
          <div className="mt-7 flex flex-wrap gap-3">
            <a href="#instalacion" className="btn-primary px-5 py-2.5 text-base" data-testid="cta-install">{t("Cómo se instala")} <ArrowRight size={16} aria-hidden /></a>
            <a href="#precios" className="btn-secondary px-5 py-2.5 text-base" data-testid="cta-pricing">{t("Precios")}</a>
          </div>
        </section>

        <section className="border-t border-slate-200 bg-white py-14 dark:border-slate-800 dark:bg-slate-900/40" aria-label={t("Por qué Pizarro")}>
          <div className="mx-auto grid max-w-5xl gap-4 px-4 sm:grid-cols-2" data-testid="pillars">
            {pillars.map((p) => {
              const Icon = PILLAR_ICONS[p.key];
              return (
                <article key={p.title} className="card p-6">
                  <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-50 text-brand-600 dark:bg-brand-500/15 dark:text-brand-300">
                    <Icon size={20} aria-hidden />
                  </span>
                  <h2 className="mt-4 text-xl font-bold tracking-tight">{p.title}</h2>
                  <p className="mt-2 text-slate-600 dark:text-slate-400">{p.text}</p>
                </article>
              );
            })}
          </div>
        </section>

        <section className="mx-auto max-w-5xl px-4 py-14" aria-labelledby="incluye">
          <SectionTitle id="incluye" title={t("Qué incluye")} />
          <ul className="grid gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-4" data-testid="includes">
            {includes.map((x) => (
              <li key={x} className="flex gap-2"><Check size={18} className="mt-0.5 shrink-0 text-brand-600 dark:text-brand-300" aria-hidden />{x}</li>
            ))}
          </ul>
        </section>

        <section className="border-t border-slate-200 bg-white py-14 dark:border-slate-800 dark:bg-slate-900/40" aria-labelledby="instalacion">
          <div className="mx-auto max-w-5xl px-4">
            <SectionTitle id="instalacion" title={t("Cómo se instala")} />
            <ol className="grid gap-4 md:grid-cols-3" data-testid="install-steps">
              {steps.map((st, i) => (
                <li key={st.title} className="card flex gap-3 p-5">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-600 text-sm font-bold text-on-brand" aria-hidden>{i + 1}</span>
                  <div>
                    <h3 className="font-semibold">{st.title}</h3>
                    <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">{st.text}</p>
                  </div>
                </li>
              ))}
            </ol>
            <p className="mt-5 text-sm">
              <a href={INSTALL_URL} rel="noopener noreferrer" className="font-medium text-brand-700 underline dark:text-brand-300">{t("Guía de instalación")}</a>
            </p>
          </div>
        </section>

        <section className="mx-auto max-w-5xl px-4 py-14" aria-labelledby="precios">
          <SectionTitle id="precios" title={t("Precios")} />
          <div className="grid gap-4 md:grid-cols-2" data-testid="pricing">
            <article className="card p-6">
              <h3 className="text-lg font-bold">{t("Gratis para uso personal")}</h3>
              <p className="mt-2 text-slate-600 dark:text-slate-400">{t("Para ti y tu familia, sin fines comerciales.")}</p>
            </article>
            <article className="card p-6">
              <h3 className="text-lg font-bold">{t("Licencia para empresas")}</h3>
              <p className="mt-2 text-slate-600 dark:text-slate-400">{t("Pago único por servidor. Actualizaciones gratis para siempre. Sin soporte incluido.")}</p>
              <p className="mt-3 text-2xl font-bold" data-testid="price">{t("{price} € + IVA", { price: LICENSE_PRICE_EUR })}<span className="text-sm font-medium text-slate-500">, {t("pago único por servidor")}</span></p>
              <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">{buyNote(t, contactEmail)}</p>
              <a href={buy} {...(buyExternal ? { target: "_blank", rel: "noopener noreferrer" } : {})} className="btn-primary mt-3 inline-flex max-w-full" data-testid="pricing-buy"><Wallet size={16} aria-hidden />{t("Comprar")}</a>
            </article>
          </div>
          <p className="mt-4 flex flex-wrap gap-x-4 gap-y-1 text-sm">
            <Link href={`/licencia?lang=${locale}`} className="font-medium text-brand-700 underline dark:text-brand-300" data-testid="license-link">{t("Lee la licencia")}</Link>
            <a href={locale === "en" ? `${SITE_URL}/en/#pricing` : `${SITE_URL}/#precios`} rel="noopener noreferrer" className="font-medium text-brand-700 underline dark:text-brand-300" data-testid="site-link">{t("Más sobre la licencia en getpizarro.com")}</a>
          </p>
        </section>

        <section className="border-t border-slate-200 bg-white py-14 dark:border-slate-800 dark:bg-slate-900/40" aria-labelledby="preguntas">
          <div className="mx-auto max-w-3xl px-4">
            <SectionTitle id="preguntas" title={t("Preguntas frecuentes")} />
            <div className="space-y-2" data-testid="faq">
              {faq.map((f) => (
                <details key={f.q} className="card group p-4">
                  <summary className="cursor-pointer font-semibold marker:text-brand-600">{f.q}</summary>
                  <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">{f.a}</p>
                </details>
              ))}
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-slate-200 py-8 text-sm text-slate-600 dark:border-slate-800 dark:text-slate-400">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-6 gap-y-3 px-4">
          <span className="mr-auto inline-flex items-center gap-2 font-semibold text-slate-900 dark:text-slate-100"><BrandMark size={22} /> Pizarro</span>
          <Link href={`/licencia?lang=${locale}`} className="hover:underline">{t("Licencia")}</Link>
          <Link href="/privacy" className="hover:underline">{t("Privacidad")}</Link>
          <Link href="/terms" className="hover:underline">{t("Condiciones")}</Link>
          <a href={locale === "en" ? `${SITE_URL}/en/` : SITE_URL} rel="noopener noreferrer" className="hover:underline">getpizarro.com</a>
          <a href={REPO_URL} rel="noopener noreferrer" className="hover:underline">GitHub</a>
          {contactEmail && <a href={`mailto:${contactEmail}`} className="inline-flex items-center gap-1 hover:underline" data-testid="landing-contact"><Mail size={14} aria-hidden />{t("Contacto")}: {contactEmail}</a>}
        </div>
      </footer>
    </div>
  );
}
