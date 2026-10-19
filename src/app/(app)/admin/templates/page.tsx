import { listVisibleProjects } from "@/lib/access";
import { listKinds } from "@/lib/board";
import { db } from "@/lib/db";
import { parseStoredTemplate } from "@/lib/project-templates";
import { requireAdminPage } from "@/lib/session";
import { TemplatesAdmin } from "./TemplatesAdmin";

export const metadata = { title: "Plantillas de proyecto" };

export default async function TemplatesPage() {
  const user = await requireAdminPage();
  const [rows, kinds, projects] = await Promise.all([
    db.projectTemplate.findMany({ orderBy: [{ position: "asc" }, { createdAt: "asc" }] }),
    listKinds(),
    listVisibleProjects(user),
  ]);
  return (
    <TemplatesAdmin
      templates={rows.map(parseStoredTemplate)}
      generalKinds={kinds.map((k) => k.name)}
      projects={projects}
    />
  );
}
