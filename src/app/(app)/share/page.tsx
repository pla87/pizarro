import { cookies } from "next/headers";
import { listVisibleProjects } from "@/lib/access";
import { db } from "@/lib/db";
import { requireUserPage } from "@/lib/session";
import { sharedText, type ShareError } from "@/lib/share-core";
import { readShare } from "@/lib/share-inbox";
import { getT } from "@/i18n/server";
import { ShareTarget } from "@/components/board/ShareTarget";

export async function generateMetadata() {
  const t = await getT();
  return { title: t("Compartir con Pizarro") };
}

type Search = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined): string => (typeof v === "string" ? v : "");
const ERRORS: ShareError[] = ["too_big", "busy", "slow", "rate", "failed", "empty"];

/**
 * Destino de «Compartir → Pizarro» (api/share redirige aquí): abre «Nueva tarea» en el último proyecto usado, con el
 * selector de proyecto, los archivos compartidos y el texto y el enlace en la descripción. Sin sesión, el acceso vuelve
 * aquí con los textos (?title=&text=&url=, y ?lost= si había archivos, que no se guardan sin sesión).
 */
export default async function SharePage({ searchParams }: { searchParams: Promise<Search> }) {
  const user = await requireUserPage();
  const sp = await searchParams;
  const id = one(sp.id);
  const meta = id ? await readShare(user.id, id) : null;
  const text = meta ?? sharedText({ title: one(sp.title), text: one(sp.text), url: one(sp.url) });
  const [projects, me] = await Promise.all([
    listVisibleProjects(user),
    db.user.findUniqueOrThrow({ where: { id: user.id }, select: { editorMode: true } }),
  ]);
  const last = (await cookies()).get("tablon_last_project")?.value;
  const target = projects.find((p) => p.id === last) ?? projects[0] ?? null;
  const error = ERRORS.find((e) => e === one(sp.error)) ?? null;
  const lost = Math.max(0, Math.min(99, Number(one(sp.lost)) || 0));
  const skipped = Math.max(0, Math.min(999, Number(one(sp.omitidos)) || 0));
  return (
    <ShareTarget
      projectId={target?.id ?? null}
      currentUserId={user.id}
      editorMode={me.editorMode}
      share={meta ? { id, files: meta.files } : null}
      text={{ title: text.title, text: text.text, url: text.url }}
      expired={!!id && !meta}
      error={error}
      lostFiles={lost}
      skippedFiles={skipped}
    />
  );
}
