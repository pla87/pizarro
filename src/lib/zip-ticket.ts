import "server-only";
import { randomBytes } from "node:crypto";

// Vale de descarga del ZIP de adjuntos del diálogo «Generar release» y del plan de trabajo. Esos ZIP se piden con la
// lista de tareas en el cuerpo (POST); para que los descargue el propio navegador (con su progreso, su botón de cancelar
// y sin guardarlo entero en la memoria de la página) el plan devuelve un vale con esa lista, y cada paquete se pide con
// un enlace normal `GET ?ticket=…&part=N`. El vale es de quien lo pidió, de ese proyecto, y caduca a los 30 min sin uso.
// Como la descarga directa no deja leer la respuesta, el vale apunta qué paquetes han empezado, cuáles han terminado y
// el error de los que fallaron: la página lo consulta (`?ticket=…&status=1`) para avisar del error y para pedir el
// siguiente paquete cuando acaba el anterior (cada persona descarga un ZIP a la vez).

interface ZipTicketItem {
  taskId: string;
  code?: string;
  folder?: string;
}

interface ZipTicket {
  userId: string;
  projectId: string;
  items: ZipTicketItem[];
  at: number;
  started: Set<number>;
  done: Set<number>;
  errors: Map<number, { status: number; message: string }>;
}

const TICKET_TTL_MS = 30 * 60 * 1000;
const MAX_TICKETS = 500;
const tickets = ((globalThis as unknown as { __pzZipTickets?: Map<string, ZipTicket> }).__pzZipTickets ??= new Map());

function prune(now: number) {
  for (const [id, tk] of tickets) if (now - tk.at > TICKET_TTL_MS) tickets.delete(id);
  // Con demasiados, se van los más antiguos (el Map guarda el orden de alta; un vale usado se vuelve a poner al final).
  while (tickets.size >= MAX_TICKETS) tickets.delete(tickets.keys().next().value!);
}

/** Vale nuevo para estos elementos (ya validados y con acceso comprobado). */
export function issueZipTicket(userId: string, projectId: string, items: ZipTicketItem[], now = Date.now()): string {
  prune(now);
  const id = randomBytes(18).toString("base64url");
  tickets.set(id, { userId, projectId, items, at: now, started: new Set(), done: new Set(), errors: new Map() });
  return id;
}

/** El vale, si existe, no ha caducado y es de esta persona y proyecto (si no, null: «no encontrado»). Cada uso lo renueva. */
export function findZipTicket(id: string, userId: string, projectId: string, now = Date.now()) {
  const tk = tickets.get(id);
  if (!tk || now - tk.at > TICKET_TTL_MS || tk.userId !== userId || tk.projectId !== projectId) return null;
  tk.at = now;
  tickets.delete(id);
  tickets.set(id, tk);
  return {
    items: tk.items,
    /** Se vuelve a pedir un paquete: se olvida lo anterior de ese paquete. */
    reset: (part: number) => {
      tk.started.delete(part);
      tk.done.delete(part);
      tk.errors.delete(part);
    },
    started: (part: number) => void tk.started.add(part),
    finished: (part: number) => void tk.done.add(part),
    failed: (part: number, status: number, message: string) => void tk.errors.set(part, { status, message }),
    /** Lo que consulta la página: paquetes empezados, terminados y fallidos (con su código y su texto). */
    status: () => ({ started: [...tk.started], done: [...tk.done], errors: Object.fromEntries(tk.errors) }),
  };
}
