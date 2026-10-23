import { listVisibleProjects } from "@/lib/access";
import { listKinds } from "@/lib/board";
import { db } from "@/lib/db";
import { listTemplatesSorted, missingBuiltinKeys } from "@/lib/template-store";
import { requireAdminPage } from "@/lib/session";
import { getT } from "@/i18n/server";
import { TemplatesAdmin } from "./TemplatesAdmin";

export async function generateMetadata() {
  const t = await getT();
  return { title: t("Plantillas de proyecto") };
}

export default async function TemplatesPage() {
  const user = await requireAdminPage();
  const [templates, missing, kinds, projects] = await Promise.all([
    listTemplatesSorted(db),
    missingBuiltinKeys(db),
    listKinds(),
    listVisibleProjects(user),
  ]);
  return (
    <TemplatesAdmin
      templates={templates}
      missingBuiltins={missing.length}
      generalKinds={kinds.map((k) => k.name)}
      projects={projects}
    />
  );
}
