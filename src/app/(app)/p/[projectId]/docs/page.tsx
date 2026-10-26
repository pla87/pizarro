import { notFound } from "next/navigation";
import { visibleProjectsWhere } from "@/lib/access";
import { db } from "@/lib/db";
import { DOCUMENTS_MAX_PER_PROJECT } from "@/lib/document-kind";
import { listProjectDocuments, listTrashedDocuments } from "@/lib/documents";
import { requireUserPage } from "@/lib/session";
import { effectiveFileMaxMb } from "@/lib/upload-size";
import { getT } from "@/i18n/server";
import { DocsManager } from "./DocsManager";

export async function generateMetadata() {
  const t = await getT();
  return { title: t("Documentación") };
}

export default async function ProjectDocsPage({ params }: { params: Promise<{ projectId: string }> }) {
  const user = await requireUserPage();
  const { projectId } = await params;
  const project = await db.project.findFirst({
    where: { id: projectId, ...visibleProjectsWhere(user) },
    select: { id: true, name: true, fileMaxMb: true },
  });
  if (!project) notFound();
  const [documents, trashed] = await Promise.all([listProjectDocuments(user, project.id), listTrashedDocuments(user, project.id)]);

  return (
    <DocsManager
      projectId={project.id}
      projectName={project.name}
      documents={documents}
      trashed={trashed}
      fileMaxMb={effectiveFileMaxMb(project.fileMaxMb)}
      maxCount={DOCUMENTS_MAX_PER_PROJECT}
    />
  );
}
