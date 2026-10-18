import { listVisibleProjects } from "@/lib/access";
import { requireUserPage } from "@/lib/session";
import { AppShell } from "@/components/AppShell";
import pkg from "../../../package.json";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUserPage();
  const projects = await listVisibleProjects(user);
  return (
    <AppShell user={user} projects={projects} version={pkg.version}>
      {children}
    </AppShell>
  );
}
