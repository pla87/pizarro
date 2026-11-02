// Lógica pura de la demo interactiva de la página de presentación: un proyecto ficticio que vive solo en el
// navegador (localStorage). No importa nada del servidor ni de la base de datos.
import type { T } from "@/i18n/core";

export type DemoKind = "Funcionalidad" | "Corrección" | "Mejora";
export type DemoRole = "NONE" | "WAITING" | "NEXT" | "PROD";

export interface DemoSub {
  id: string;
  text: string;
  done: boolean;
}

export interface DemoTask {
  id: string;
  /** En las tareas de ejemplo es la clave en español (se traduce al mostrarla); en las creadas, el texto tal cual. */
  title: string;
  kind: DemoKind;
  labels: string[];
  /** Fecha límite AAAA-MM-DD. */
  due: string | null;
  desc: string;
  subs: DemoSub[];
  /** Desde cuándo está en una columna «Esperando» (AAAA-MM-DD). */
  since: string | null;
  /** Creada por quien prueba la demo: no se traduce. */
  custom?: boolean;
}

export interface DemoColumn {
  id: string;
  name: string;
  role: DemoRole;
  taskIds: string[];
}

export interface DemoState {
  v: 1;
  columns: DemoColumn[];
  tasks: Record<string, DemoTask>;
  nextId: number;
}

export const DEMO_STORAGE_KEY = "pizarro-demo-v1";
export const DEMO_WAITING_DAYS = 3;
export const KIND_ORDER: DemoKind[] = ["Funcionalidad", "Corrección", "Mejora"];
export const KIND_COLOR: Record<DemoKind, string> = { Funcionalidad: "#6366f1", Corrección: "#ef4444", Mejora: "#0ea5e9" };

const pad = (n: number) => String(n).padStart(2, "0");
export const isoDay = (d: Date): string => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const ymd = (iso: string): [number, number, number] => {
  const [y = 1970, m = 1, d = 1] = iso.split("-").map(Number);
  return [y, m, d];
};
export function addDays(iso: string, n: number): string {
  const [y, m, d] = ymd(iso);
  return isoDay(new Date(y, m - 1, d + n));
}
export function daysBetween(fromIso: string, toIso: string): number {
  const [y1, m1, d1] = ymd(fromIso);
  const [y2, m2, d2] = ymd(toIso);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86400000);
}

function task(id: string, title: string, kind: DemoKind, labels: string[], due: string | null, desc: string, subs: [string, boolean][] = [], since: string | null = null): DemoTask {
  return { id, title, kind, labels, due, desc, since, subs: subs.map(([text, done], i) => ({ id: `${id}s${i}`, text, done })) };
}

/** Proyecto de ejemplo con fechas relativas a `today` (AAAA-MM-DD). */
export function seedState(today: string): DemoState {
  const list: DemoTask[] = [
    task("t1", "Modo oscuro en el calendario", "Mejora", ["Frontend"], addDays(today, 9), "Revisar los colores de las franjas y de los días festivos.", [["Definir la paleta oscura", true], ["Adaptar las franjas", false], ["Probar en el móvil", false]]),
    task("t2", "Exportar las reservas a CSV", "Funcionalidad", ["Backend"], addDays(today, 14), "Un botón que descargue las reservas del mes en un archivo CSV.", [["Elegir las columnas", false], ["Escribir el exportador", false]]),
    task("t3", "Buscador de reservas por nombre", "Funcionalidad", ["Frontend"], addDays(today, 3), "Buscar sin distinguir mayúsculas ni tildes.", [["Campo de búsqueda", true], ["Resultados al escribir", true], ["Resaltar coincidencias", false], ["Pruebas", false]]),
    task("t4", "Error al cancelar una reserva dos veces", "Corrección", ["Backend", "Urgente"], addDays(today, 1), "Si se pulsa dos veces seguidas, la segunda falla con un error 500.", [["Reproducir el fallo", true], ["Ignorar la segunda petición", false]]),
    task("t5", "Confirmar los textos legales con el cliente", "Mejora", ["Diseño"], null, "Pendiente de que el cliente confirme la política de privacidad.", [], addDays(today, -4)),
    task("t6", "Recordatorio por email un día antes", "Funcionalidad", ["Backend"], addDays(today, 2), "Avisar a quien tiene una reserva al día siguiente.", [["Plantilla del mensaje", true], ["Tarea programada", true]]),
    task("t7", "Corregir el cálculo de huecos libres", "Corrección", ["Backend"], addDays(today, 2), "Los huecos que cruzan la medianoche no se contaban.", [["Caso de prueba", true], ["Arreglo", true]]),
    task("t8", "Mejorar el contraste de los botones", "Mejora", ["Diseño", "Frontend"], null, "Subir el contraste de los botones secundarios en el tema claro.", []),
    task("t9", "Pantalla de acceso", "Funcionalidad", ["Frontend"], null, "Acceso con correo y contraseña.", [["Formulario", true], ["Mensajes de error", true]]),
  ];
  return {
    v: 1,
    nextId: 100,
    tasks: Object.fromEntries(list.map((x) => [x.id, x])),
    columns: [
      { id: "c1", name: "Pendiente", role: "NONE", taskIds: ["t1", "t2"] },
      { id: "c2", name: "En curso", role: "NONE", taskIds: ["t3", "t4"] },
      { id: "c3", name: "Esperando", role: "WAITING", taskIds: ["t5"] },
      { id: "c4", name: "Siguiente salto", role: "NEXT", taskIds: ["t6", "t7", "t8"] },
      { id: "c5", name: "En producción", role: "PROD", taskIds: ["t9"] },
    ],
  };
}

/** Textos en español de las tareas y columnas de ejemplo (para comprobar que todos tienen traducción). */
export function seedStrings(): string[] {
  const s = seedState("2026-01-01");
  const out = new Set<string>();
  for (const c of s.columns) out.add(c.name);
  for (const x of Object.values(s.tasks)) {
    out.add(x.title);
    out.add(x.desc);
    x.labels.forEach((l) => out.add(l));
    x.subs.forEach((u) => out.add(u.text));
  }
  return [...out];
}

/** Valida lo leído de localStorage; null si no es utilizable (entonces se parte del ejemplo). */
export function parseState(raw: string | null): DemoState | null {
  if (!raw) return null;
  try {
    const s = JSON.parse(raw) as DemoState;
    if (s?.v !== 1 || !Array.isArray(s.columns) || typeof s.tasks !== "object" || s.tasks === null || typeof s.nextId !== "number") return null;
    const seen = new Set<string>();
    for (const c of s.columns) {
      if (typeof c.id !== "string" || typeof c.name !== "string" || !Array.isArray(c.taskIds)) return null;
      for (const id of c.taskIds) {
        const x = s.tasks[id];
        if (!x || seen.has(id) || !Array.isArray(x.subs) || !Array.isArray(x.labels) || !KIND_ORDER.includes(x.kind)) return null;
        seen.add(id);
      }
    }
    return Object.keys(s.tasks).length === seen.size ? s : null;
  } catch {
    return null;
  }
}

export function findColumn(s: DemoState, taskId: string): DemoColumn | undefined {
  return s.columns.find((c) => c.taskIds.includes(taskId));
}

/** Mueve una tarjeta a una columna (a `index`, o al final). En «Esperando» empieza a contar los días. */
export function moveTask(s: DemoState, taskId: string, toColumnId: string, index?: number, today = isoDay(new Date())): DemoState {
  const from = findColumn(s, taskId);
  const to = s.columns.find((c) => c.id === toColumnId);
  if (!from || !to || !s.tasks[taskId]) return s;
  const without = (c: DemoColumn) => c.taskIds.filter((id) => id !== taskId);
  const target = without(to);
  const at = index === undefined ? target.length : Math.max(0, Math.min(index, target.length));
  target.splice(at, 0, taskId);
  const prev = s.tasks[taskId];
  const since = to.role === "WAITING" ? (from.id === to.id ? prev.since ?? today : today) : null;
  return {
    ...s,
    tasks: { ...s.tasks, [taskId]: { ...prev, since } },
    columns: s.columns.map((c) => (c.id === to.id ? { ...c, taskIds: target } : c.id === from.id ? { ...c, taskIds: without(c) } : c)),
  };
}

export function addTask(s: DemoState, columnId: string, title: string, today = isoDay(new Date())): DemoState {
  const clean = title.trim().slice(0, 120);
  const col = s.columns.find((c) => c.id === columnId);
  if (!clean || !col) return s;
  const id = `n${s.nextId}`;
  const created: DemoTask = { id, title: clean, kind: "Funcionalidad", labels: [], due: null, desc: "", subs: [], since: col.role === "WAITING" ? today : null, custom: true };
  return { ...s, nextId: s.nextId + 1, tasks: { ...s.tasks, [id]: created }, columns: s.columns.map((c) => (c.id === columnId ? { ...c, taskIds: [...c.taskIds, id] } : c)) };
}

export function updateTask(s: DemoState, taskId: string, patch: Partial<Pick<DemoTask, "kind">>): DemoState {
  const prev = s.tasks[taskId];
  if (!prev) return s;
  return { ...s, tasks: { ...s.tasks, [taskId]: { ...prev, ...patch } } };
}

export function toggleSub(s: DemoState, taskId: string, subId: string): DemoState {
  const prev = s.tasks[taskId];
  if (!prev) return s;
  return { ...s, tasks: { ...s.tasks, [taskId]: { ...prev, subs: prev.subs.map((u) => (u.id === subId ? { ...u, done: !u.done } : u)) } } };
}

export function removeTask(s: DemoState, taskId: string): DemoState {
  const rest = { ...s.tasks };
  delete rest[taskId];
  return { ...s, tasks: rest, columns: s.columns.map((c) => ({ ...c, taskIds: c.taskIds.filter((id) => id !== taskId) })) };
}

/** Texto de una tarea para mostrar: las de ejemplo se traducen, las creadas no. */
export function taskTitle(t: T, x: DemoTask): string {
  return x.custom ? x.title : t(x.title);
}

/** Notas de release en Markdown con las tareas de la columna «Siguiente salto», agrupadas por tipo. Vacío si no hay ninguna. */
export function releaseMarkdown(s: DemoState, t: T, today = isoDay(new Date())): string {
  const col = s.columns.find((c) => c.role === "NEXT");
  const items = (col?.taskIds ?? []).map((id) => s.tasks[id]).filter((x): x is DemoTask => !!x);
  if (items.length === 0) return "";
  const out = [`# ${t("Release {fecha}", { fecha: today })}`];
  for (const kind of KIND_ORDER) {
    const group = items.filter((x) => x.kind === kind);
    if (group.length === 0) continue;
    out.push("", `## ${t(kind)}`);
    for (const x of group) out.push(`- ${taskTitle(t, x)}`);
  }
  return out.join("\n") + "\n";
}

export function subsProgress(x: DemoTask): { done: number; total: number } {
  return { done: x.subs.filter((u) => u.done).length, total: x.subs.length };
}
