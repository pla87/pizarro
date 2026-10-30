import { db } from "@/lib/db";
import { getLegalSettings } from "@/lib/legal";
import { requireAdminPage } from "@/lib/session";
import { getT } from "@/i18n/server";
import { LegalAdmin } from "./LegalAdmin";

export async function generateMetadata() {
  const t = await getT();
  return { title: t("Textos legales") };
}

export default async function LegalPageAdmin() {
  const user = await requireAdminPage();
  const [settings, me] = await Promise.all([getLegalSettings(), db.user.findUnique({ where: { id: user.id }, select: { editorMode: true } })]);
  return <LegalAdmin settings={settings} editorMode={me?.editorMode ?? "MARKDOWN"} />;
}
