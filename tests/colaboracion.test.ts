import assert from "node:assert/strict";
import { test } from "node:test";

process.env.SESSION_SECRET = "x".repeat(48);
process.env.DATABASE_URL ??= "postgresql://test:test@localhost:5432/test";

const { followerIds, isFollowing } = await import("../src/lib/followers");
const { digestDue, localParts, reportDue } = await import("../src/lib/schedule");
const { bucketOf, groupByDue, matchesFilter, parseFilter } = await import("../src/lib/my-tasks");
const { buildDigest, digestEmail, emptyDigestInput, DIGEST_MAX_ITEMS } = await import("../src/lib/digest");
const { dueChangeExcerpt, dueChangeText, parseDueChange } = await import("../src/lib/notification-text");
const { splitMentions, mentionToken } = await import("../src/lib/mentions");
const { eventsOf } = await import("../src/lib/task-events");
const { emailWanted, mentionEmail } = await import("../src/lib/notify");
const { taskTitle } = await import("../src/lib/validation");
const { makeT } = await import("../src/i18n/core");

// --- Seguidores ---

test("seguidores: creador y asignado siguen la tarea sin filas", () => {
  const task = { createdById: "ana", assigneeId: "bea", rows: [] };
  assert.deepEqual(followerIds(task).sort(), ["ana", "bea"]);
  assert.equal(isFollowing("carlos", task), false);
});

test("seguidores: dejar de seguir (muted) gana al seguimiento implícito", () => {
  const task = { createdById: "ana", assigneeId: "bea", rows: [{ userId: "ana", muted: true }] };
  assert.deepEqual(followerIds(task), ["bea"]);
  assert.equal(isFollowing("ana", task), false);
});

test("seguidores: quien comenta o es mencionado (fila sin muted) sigue; el autor del cambio se excluye", () => {
  const task = { createdById: null, assigneeId: null, rows: [{ userId: "carlos", muted: false }, { userId: "dani", muted: false }, { userId: "eva", muted: true }] };
  assert.deepEqual(followerIds(task, ["carlos"]), ["dani"]);
  assert.equal(isFollowing("eva", task), false);
});

test("seguidores: sin duplicados si el creador es además el asignado", () => {
  assert.deepEqual(followerIds({ createdById: "ana", assigneeId: "ana", rows: [{ userId: "ana", muted: false }] }), ["ana"]);
});

// --- Cuándo toca enviar ---

test("localParts: fecha, hora y día ISO en la zona de la app", () => {
  // 2026-10-19 es lunes (el cambio de hora fue el 25); 06:30 UTC son las 08:30 en Madrid (CEST).
  assert.deepEqual(localParts(new Date("2026-10-19T06:30:00Z"), "Europe/Madrid"), { date: "2026-10-19", hour: 8, weekday: 1 });
  // 23:30 UTC del domingo ya es lunes en Madrid.
  assert.deepEqual(localParts(new Date("2026-10-18T23:30:00Z"), "Europe/Madrid"), { date: "2026-10-19", hour: 1, weekday: 1 });
  assert.equal(localParts(new Date("2026-10-18T12:00:00Z"), "Europe/Madrid").weekday, 7);
});

test("resumen diario: a partir de la hora elegida y una sola vez al día", () => {
  const tz = "Europe/Madrid";
  const before = new Date("2026-10-19T05:59:00Z"); // 07:59 en Madrid
  const at = new Date("2026-10-19T06:10:00Z"); // 08:10
  assert.equal(digestDue(before, tz, { hour: 8, lastSentAt: null }), false);
  assert.equal(digestDue(at, tz, { hour: 8, lastSentAt: null }), true);
  // El mantenimiento no corre en punto: más tarde ese mismo día sigue tocando si no se envió.
  assert.equal(digestDue(new Date("2026-10-19T15:00:00Z"), tz, { hour: 8, lastSentAt: null }), true);
  // Ya enviado hoy: no se repite; ayer sí permite el de hoy.
  assert.equal(digestDue(new Date("2026-10-19T15:00:00Z"), tz, { hour: 8, lastSentAt: at }), false);
  assert.equal(digestDue(at, tz, { hour: 8, lastSentAt: new Date("2026-10-18T06:10:00Z") }), true);
});

test("informe semanal: solo el día elegido, desde la hora elegida y una vez", () => {
  const tz = "Europe/Madrid";
  const monday = new Date("2026-10-19T06:10:00Z"); // lunes 08:10
  const tuesday = new Date("2026-10-20T06:10:00Z");
  const s = { weekday: 1, hour: 8, lastSentAt: null as Date | null };
  assert.equal(reportDue(monday, tz, s), true);
  assert.equal(reportDue(tuesday, tz, s), false);
  assert.equal(reportDue(new Date("2026-10-19T05:00:00Z"), tz, s), false);
  assert.equal(reportDue(new Date("2026-10-19T18:00:00Z"), tz, { ...s, lastSentAt: monday }), false);
  assert.equal(reportDue(monday, tz, { ...s, lastSentAt: new Date("2026-10-12T06:10:00Z") }), true);
});

// --- Mis tareas ---

test("mis tareas: grupos por vencimiento respecto a hoy", () => {
  const today = "2026-10-23";
  assert.equal(bucketOf("2026-10-22", today), "overdue");
  assert.equal(bucketOf("2026-10-23", today), "today");
  assert.equal(bucketOf("2026-10-30", today), "week");
  assert.equal(bucketOf("2026-10-31", today), "later");
  assert.equal(bucketOf(null, today), "none");
});

test("mis tareas: orden vencidas, hoy, semana, más adelante, sin fecha y orden por fecha dentro del grupo", () => {
  const today = "2026-10-23";
  const tasks = [
    { id: "a", dueDate: null },
    { id: "b", dueDate: "2026-12-01" },
    { id: "c", dueDate: "2026-10-25" },
    { id: "d", dueDate: "2026-10-20" },
    { id: "e", dueDate: "2026-10-23" },
    { id: "f", dueDate: "2026-10-19" },
    { id: "g", dueDate: "2026-10-24" },
  ];
  const groups = groupByDue(tasks, today);
  assert.deepEqual(groups.map((g) => g.bucket), ["overdue", "today", "week", "later", "none"]);
  assert.deepEqual(groups[0]!.tasks.map((t) => t.id), ["f", "d"]);
  assert.deepEqual(groups[2]!.tasks.map((t) => t.id), ["g", "c"]);
});

test("mis tareas: filtros «Vencidas» y «Esta semana»; los grupos vacíos no salen", () => {
  const today = "2026-10-23";
  const tasks = [{ dueDate: "2026-10-01" }, { dueDate: "2026-10-23" }, { dueDate: "2026-11-30" }, { dueDate: null }];
  assert.deepEqual(groupByDue(tasks, today, "overdue").map((g) => g.bucket), ["overdue"]);
  assert.deepEqual(groupByDue(tasks, today, "week").map((g) => g.bucket), ["overdue", "today"]);
  assert.equal(groupByDue(tasks, today, "all").length, 4);
  assert.equal(matchesFilter("later", "week"), false);
  assert.equal(parseFilter("overdue"), "overdue");
  assert.equal(parseFilter(["week", "x"]), "week");
  assert.equal(parseFilter("otra"), "all");
  assert.equal(parseFilter(undefined), "all");
});

// --- Resumen diario ---

test("resumen: agrupa por sección y proyecto, sin repetir tareas, y omite lo vacío", () => {
  const input = emptyDigestInput();
  const item = (taskId: string, projectId: string, projectName: string, extra = {}) => ({ taskId, title: `T-${taskId}`, projectId, projectName, ...extra });
  input.created = [item("1", "p2", "Zeta"), item("2", "p1", "Alfa"), item("1", "p2", "Zeta")];
  input.overdue = [item("3", "p1", "Alfa")];
  const digest = buildDigest(input);
  assert.equal(digest.empty, false);
  assert.deepEqual(digest.sections.map((s) => s.key), ["overdue", "created"]);
  const created = digest.sections[1]!;
  assert.equal(created.total, 2);
  assert.deepEqual(created.projects.map((p) => p.projectName), ["Alfa", "Zeta"]);
  assert.equal(buildDigest(emptyDigestInput()).empty, true);
});

test("resumen: recorta las secciones largas y cuenta las que no caben", () => {
  const input = emptyDigestInput();
  input.created = Array.from({ length: DIGEST_MAX_ITEMS + 5 }, (_, i) => ({ taskId: String(i), title: "x", projectId: "p", projectName: "P" }));
  const section = buildDigest(input).sections[0]!;
  assert.equal(section.total, DIGEST_MAX_ITEMS + 5);
  assert.equal(section.hidden, 5);
  assert.equal(section.projects[0]!.items.length, DIGEST_MAX_ITEMS);
});

test("resumen: el correo escapa el HTML, usa menciones en texto plano y enlaza con APP_URL", () => {
  const input = emptyDigestInput();
  input.assigned = [{ taskId: "t1", title: `Revisar <b>x</b> ${mentionToken("Ana", "u1")}`, projectId: "p1", projectName: "Web & Co" }];
  const mail = digestEmail(buildDigest(input), { name: "Luz <i>", baseUrl: "https://app.example.com" }, makeT("es"));
  assert.match(mail.subject, /\(1\)/);
  assert.ok(mail.html.includes("Web &amp; Co"));
  assert.ok(!mail.html.includes("<b>x</b>"));
  assert.ok(mail.html.includes("Luz &lt;i&gt;"));
  assert.ok(mail.text.includes("@Ana"));
  assert.ok(!mail.text.includes("user:u1"));
  assert.ok(mail.text.includes("https://app.example.com/p/p1?task=t1"));
  assert.match(digestEmail(buildDigest(input), { name: "Luz", baseUrl: "https://a.b" }, makeT("en")).subject, /daily summary/);
});

// --- Avisos ---

test("avisos: texto del cambio de fecha", () => {
  assert.equal(dueChangeExcerpt("2026-10-01", null), "2026-10-01>");
  assert.deepEqual(parseDueChange("2026-10-01>2026-10-05"), { from: "2026-10-01", to: "2026-10-05" });
  assert.deepEqual(parseDueChange(">2026-10-05"), { from: null, to: "2026-10-05" });
  assert.match(dueChangeText(">2026-10-05", makeT("en"), "en-GB"), /^No date → 5 Oct/);
});

test("avisos: email por tipo y preferencias", () => {
  const msg = { actorName: "Ana", taskTitle: "Pantalla", projectName: "Web", excerpt: "Hola", url: "https://a.b/p/1?task=2" };
  assert.match(mentionEmail({ ...msg, type: "ASSIGNED" }).subject, /Ana te ha asignado «Pantalla»/);
  assert.match(mentionEmail({ ...msg, type: "REPLY" }, makeT("en")).subject, /replied to your comment/);
  assert.match(mentionEmail({ ...msg, type: "DUE_CHANGED", excerpt: "2026-10-01>2026-10-05" }).text, /→/);
  const prefs = { notifyEmail: true, notifyAssignedEmail: false, notifyDueEmail: true, notifyCommentEmail: false };
  assert.equal(emailWanted("MENTION", prefs), true);
  assert.equal(emailWanted("ASSIGNED", prefs), false);
  assert.equal(emailWanted("DUE_CHANGED", prefs), true);
  assert.equal(emailWanted("COMMENT", prefs), false);
  assert.equal(emailWanted("REPLY", prefs), false);
});

// --- Menciones en el título ---

test("menciones: trozos de texto y etiquetas", () => {
  const text = `Hablar con ${mentionToken("Ana", "u1")} y ${mentionToken("Luis", "u2")}.`;
  assert.deepEqual(splitMentions(text), ["Hablar con ", { name: "Ana", id: "u1" }, " y ", { name: "Luis", id: "u2" }, "."]);
  assert.deepEqual(splitMentions("sin menciones"), ["sin menciones"]);
});

test("título: el límite de 210 cuenta el texto visible, no la mención guardada", () => {
  const mention = mentionToken("Ana", "cl1234567890abcdefghij123");
  assert.ok(mention.length > 30);
  assert.equal(taskTitle.safeParse(`${"a".repeat(200)} ${mention}`).success, true);
  assert.equal(taskTitle.safeParse("a".repeat(211)).success, false);
  assert.equal(taskTitle.safeParse("   ").success, false);
});

// --- Historial ---

test("historial: eventos explícitos de la acción sustituyen a la etiqueta genérica", () => {
  const label = { k: "Movió «{title}»", p: { title: "X" } };
  assert.deepEqual(eventsOf("tasks.moveTask", { taskId: "t1", label, events: undefined }), [{ taskId: "t1", code: "other", label }]);
  assert.deepEqual(eventsOf("tasks.addComment", { taskId: "t1", label, events: undefined }).map((e) => e.code), ["comment"]);
  const explicit = [{ taskId: "t1", code: "done", label }];
  assert.deepEqual(eventsOf("tasks.moveTask", { taskId: "t1", label, events: explicit }), explicit);
  // [] = la acción pide no anotar nada (p. ej. reordenar dentro de la misma columna).
  assert.deepEqual(eventsOf("tasks.moveTask", { taskId: "t1", label, events: [] }), []);
  assert.deepEqual(eventsOf("tasks.reorderSubtask", { taskId: "t1", label, events: undefined }), []);
  assert.deepEqual(eventsOf("tasks.deleteTasks", { taskId: undefined, label, events: undefined }), []);
});
