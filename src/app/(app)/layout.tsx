import { listVisibleProjects, visibleProjectsWhere } from "@/lib/access";
import { db } from "@/lib/db";
import { requireUserPage } from "@/lib/session";
import { AppShell } from "@/components/AppShell";
import { ClientErrorReporter } from "@/components/ClientErrorReporter";
import { VersionWatcher } from "@/components/VersionWatcher";
import pkg from "../../../package.json";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUserPage();
  const [projects, unread] = await Promise.all([
    listVisibleProjects(user),
    db.notification.count({ where: { userId: user.id, readAt: null, task: { project: visibleProjectsWhere(user) } } }),
  ]);
  return (
    <AppShell user={user} projects={projects.map((p) => ({ id: p.id, name: p.name, isPrivate: !!p.privateOwnerId }))} version={pkg.version} unread={unread}>
      <ClientErrorReporter />
      <VersionWatcher />
      {children}
    </AppShell>
  );
}
