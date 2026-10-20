import Link from "next/link";
import { getT } from "@/i18n/server";

export default async function NotFound() {
  const t = await getT();
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
      <p className="text-lg font-semibold">{t("No encontrado")}</p>
      <p className="text-sm text-slate-500">{t("La página no existe o no tienes acceso.")}</p>
      <Link href="/" className="btn-secondary">{t("Volver al inicio")}</Link>
    </div>
  );
}
