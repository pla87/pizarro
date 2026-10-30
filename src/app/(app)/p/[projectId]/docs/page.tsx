import { notFound } from "next/navigation";
import { visibleProjectsWhere } from "@/lib/access";
import { db } from "@/lib/db";
import { DOCUMENTS_MAX_PER_PROJECT } from "@/lib/document-kind";
import { listProjectDocumentsOf, listTrashedDocumentsOf } from "@/lib/documents";
import { requireUserPage } from "@/lib/session";
import { effectiveFileMaxMb } from "@/lib/upload-size";
import { getT } from "@/i18n/server";
import { DocsManager } from "./DocsManager";

export async function generateMetadata() {
  const t = await getT();
  return { title: t("Documentación") };
}

export default async function ProjectDocsPage({ params, searchParams }: { params: Promise<{ projectId: string }>; searchParams: Promise<{ doc?: string | string[] }> }) {
  const user = await requireUserPage();
  const { projectId } = await params;
  const project = await db.project.findFirst({
    where: { id: projectId, ...visibleProjectsWhere(user) },
    select: { id: true, name: true, fileMaxMb: true },
  });
  if (!project) notFound();
  const [documents, trashed, me, { doc }] = await Promise.all([
    listProjectDocumentsOf(project.id),
    listTrashedDocumentsOf(project.id),
    db.user.findUniqueOrThrow({ where: { id: user.id }, select: { editorMode: true } }),
    searchParams,
  ]);

  return (
    <DocsManager
      projectId={project.id}
      projectName={project.name}
      documents={documents}
      trashed={trashed}
      fileMaxMb={effectiveFileMaxMb(project.fileMaxMb)}
      maxCount={DOCUMENTS_MAX_PER_PROJECT}
      currentUserId={user.id}
      editorMode={me.editorMode}
      initialOpenId={typeof doc === "string" && documents.some((d) => d.id === doc) ? doc : null}
    />
  );
}
