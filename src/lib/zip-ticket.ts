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
  /** La lista en texto: si la misma persona vuelve a pedir la misma, se reutiliza el vale. */
  key: string;
  at: number;
  started: Set<number>;
  done: Set<number>;
  errors: Map<number, { status: number; message: string }>;
}

const TICKET_TTL_MS = 30 * 60 * 1000;
const MAX_TICKETS = 500;
/**
 * Vales a la vez por persona (descarga uno a la vez; unos pocos cubren varias pestañas). Al pasarse se va el más antiguo
 * de esa persona: con solo el tope global, una persona pidiendo planes sin parar expulsaba los vales en curso de otras.
 */
const MAX_TICKETS_PER_USER = 5;
const tickets = ((globalThis as unknown as { __pzZipTickets?: Map<string, ZipTicket> }).__pzZipTickets ??= new Map());

function prune(userId: string, now: number) {
  const mine: string[] = [];
  for (const [id, tk] of tickets) {
    if (now - tk.at > TICKET_TTL_MS) tickets.delete(id);
    else if (tk.userId === userId) mine.push(id);
  }
  // El Map guarda el orden de alta (un vale usado se vuelve a poner al final): los primeros son los más antiguos.
  while (mine.length >= MAX_TICKETS_PER_USER) tickets.delete(mine.shift()!);
  // Con demasiados en total, se van los más antiguos.
  while (tickets.size >= MAX_TICKETS) tickets.delete(tickets.keys().next().value!);
}

/**
 * Vale para estos elementos (ya validados y con acceso comprobado). Si la misma persona ya tiene uno vigente para la
 * misma lista en el mismo proyecto, se reutiliza (y se olvida su estado: es una descarga nueva).
 */
export function issueZipTicket(userId: string, projectId: string, items: ZipTicketItem[], now = Date.now()): string {
  const key = JSON.stringify(items.map((i) => [i.taskId, i.code ?? null, i.folder ?? null]));
  for (const [id, tk] of tickets) {
    if (tk.userId !== userId || tk.projectId !== projectId || tk.key !== key || now - tk.at > TICKET_TTL_MS) continue;
    tk.at = now;
    tk.started.clear();
    tk.done.clear();
    tk.errors.clear();
    tickets.delete(id);
    tickets.set(id, tk);
    return id;
  }
  prune(userId, now);
  const id = randomBytes(18).toString("base64url");
  tickets.set(id, { userId, projectId, items, key, at: now, started: new Set(), done: new Set(), errors: new Map() });
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
