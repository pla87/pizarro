import "server-only";

// Avisos en tiempo (casi) real: cada cambio en un proyecto se anuncia a las pestañas que lo
// tienen abierto (/api/projects/[id]/events) y estas se refrescan. En memoria: una sola instancia.

export interface ProjectChange {
  projectId: string;
  userId: string | null;
  action: string;
  at: number;
}

type Listener = (change: ProjectChange) => void;
const channels = (globalThis as unknown as { __pzRealtime?: Map<string, Set<Listener>> }).__pzRealtime ??= new Map();

export function subscribeProject(projectId: string, listener: Listener): () => void {
  let set = channels.get(projectId);
  if (!set) channels.set(projectId, (set = new Set()));
  set.add(listener);
  return () => {
    set.delete(listener);
    if (set.size === 0) channels.delete(projectId);
  };
}

export function publishChange(change: Omit<ProjectChange, "at">): void {
  const set = channels.get(change.projectId);
  if (!set) return;
  const full = { ...change, at: Date.now() };
  for (const l of set) {
    try {
      l(full);
    } catch {
      // Un oyente roto (pestaña cerrada) no afecta al resto.
    }
  }
}
