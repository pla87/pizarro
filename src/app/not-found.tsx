import type { Metadata } from "next";
import Link from "next/link";
import { getT } from "@/i18n/server";

// Dirección que no existe fuera de la app con sesión (la de dentro es (app)/not-found.tsx, dentro del menú). Sin esto,
// Next pintaba su página en inglés, con su propio <title> en el cuerpo (dos títulos) y sin el tema oscuro. El fondo y el
// tema los pone el layout raíz (body y data-theme).
export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t("No encontrado") };
}

export default async function NotFound() {
  const t = await getT();
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-3 p-6 text-center">
      <h1 className="text-lg font-semibold">{t("No encontrado")}</h1>
      <p className="text-sm text-slate-600 dark:text-slate-400">{t("La página no existe o no tienes acceso.")}</p>
      <Link href="/" className="btn-secondary">{t("Volver al inicio")}</Link>
    </main>
  );
}
