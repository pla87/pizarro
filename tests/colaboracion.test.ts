import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";

process.env.SESSION_SECRET = "x".repeat(48);
process.env.DATABASE_URL ??= "postgresql://test:test@localhost:5432/test";

const { followerIds, isFollowing } = await import("../src/lib/followers");
const { digestDue, localParts, reportDue } = await import("../src/lib/schedule");
const { bucketAnchor, bucketCount, bucketOf, cutBucket, groupByDue } = await import("../src/lib/my-tasks");
const { buildDigest, digestEmail, digestPeriod, emptyDigestInput, DIGEST_MAX_ITEMS } = await import("../src/lib/digest");
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

test("informe semanal: no se repite si el último salió hace menos de 3 días", () => {
  const tz = "Europe/Madrid";
  const sentMonday = new Date("2026-10-19T06:10:00Z"); // lunes 08:10
  // Cambiado al martes o al miércoles tras el envío del lunes: no se repite esa semana.
  assert.equal(reportDue(new Date("2026-10-20T06:10:00Z"), tz, { weekday: 2, hour: 8, lastSentAt: sentMonday }), false);
  assert.equal(reportDue(new Date("2026-10-21T06:10:00Z"), tz, { weekday: 3, hour: 8, lastSentAt: sentMonday }), false);
  // Al jueves o al viernes: ya han pasado 3 días, sí llega.
  assert.equal(reportDue(new Date("2026-10-22T06:10:00Z"), tz, { weekday: 4, hour: 8, lastSentAt: sentMonday }), true);
  assert.equal(reportDue(new Date("2026-10-23T06:10:00Z"), tz, { weekday: 5, hour: 8, lastSentAt: sentMonday }), true);
  // El lunes siguiente, aunque la pasada sea unos minutos antes que la del envío anterior.
  assert.equal(reportDue(new Date("2026-10-26T07:05:00Z"), tz, { weekday: 1, hour: 8, lastSentAt: sentMonday }), true);
  // Enviado el domingo: el lunes siguiente no se repite (menos de 3 días).
  assert.equal(reportDue(new Date("2026-10-26T07:10:00Z"), tz, { weekday: 1, hour: 8, lastSentAt: new Date("2026-10-25T09:00:00Z") }), false);
});

test("informe semanal: si falló el día elegido, sale en cuanto pueda; sin dos en la misma semana", () => {
  const tz = "Europe/Madrid";
  const sentMonday = new Date("2026-10-19T06:10:00Z"); // lunes 08:10
  const s = { weekday: 1, hour: 8, lastSentAt: sentMonday };
  // El lunes 26 el servidor estaba parado todo el día: el martes antes de cumplirse 8 días aún no toca...
  assert.equal(reportDue(new Date("2026-10-27T05:00:00Z"), tz, s), false); // martes 06:00: 7 días y 22 h
  // ...y desde las 8 días y poco (martes por la mañana) sí, aunque no sea el día elegido.
  assert.equal(reportDue(new Date("2026-10-27T07:30:00Z"), tz, s), true);
  assert.equal(reportDue(new Date("2026-10-29T10:00:00Z"), tz, s), true);
  // Recuperado el martes: no vuelve a salir hasta el lunes siguiente (menos de 3 días y luego el día elegido).
  const recovered = new Date("2026-10-27T07:30:00Z");
  assert.equal(reportDue(new Date("2026-10-28T07:30:00Z"), tz, { ...s, lastSentAt: recovered }), false);
  assert.equal(reportDue(new Date("2026-11-02T07:30:00Z"), tz, { ...s, lastSentAt: recovered }), true);
  // Sin ningún envío anterior no se recupera nada: activar el informe a mitad de semana no manda uno al momento.
  assert.equal(reportDue(new Date("2026-10-28T10:00:00Z"), tz, { ...s, lastSentAt: null }), false);
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

test("mis tareas: los grupos vacíos no salen y cada grupo tiene su ancla", () => {
  const today = "2026-10-23";
  const tasks = [{ dueDate: "2026-10-01" }, { dueDate: "2026-10-23" }, { dueDate: "2026-11-30" }, { dueDate: null }];
  assert.deepEqual(groupByDue(tasks, today).map((g) => g.bucket), ["overdue", "today", "later", "none"]);
  assert.deepEqual(groupByDue([], today), []);
  assert.equal(bucketAnchor("overdue"), "tareas-overdue");
});

test("mis tareas con más de las que se pintan: el grupo cortado sale con «+», los completos con su número", () => {
  const today = "2026-10-23";
  const shown = [{ dueDate: "2026-10-01" }, { dueDate: "2026-11-30" }, { dueDate: "2026-12-01" }];
  const groups = groupByDue(shown, today);
  // La siguiente (no pintada) es de «Más adelante»: ese grupo está cortado.
  const cut = cutBucket({ dueDate: "2026-12-02" }, today);
  assert.deepEqual(groups.map((g) => bucketCount(g, cut)), ["1", "2+"]);
  // La siguiente es «Sin fecha»: «Más adelante» está completo (y «Sin fecha» no se pinta; lo dice el aviso del total).
  assert.deepEqual(groups.map((g) => bucketCount(g, cutBucket({ dueDate: null }, today))), ["1", "2"]);
  // Sin más tareas, ninguno.
  assert.deepEqual(groups.map((g) => bucketCount(g, cutBucket(undefined, today))), ["1", "2"]);
});

test("mis tareas: sin filtros; un ?filter= antiguo (marcadores) redirige a la página limpia", () => {
  const src = readFileSync("src/app/(app)/my-tasks/page.tsx", "utf8");
  assert.doesNotMatch(src, /my-tasks\?filter=/);
  assert.match(src, /redirect\("\/my-tasks"\)/);
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

test("resumen: el asunto cuenta tareas distintas, el texto dice desde cuándo y el pie, que no se responda", () => {
  const input = emptyDigestInput();
  const item = (taskId: string) => ({ taskId, title: `T-${taskId}`, projectId: "p", projectName: "P" });
  // La misma tarea asignada, vencida y comentada: una sola en el asunto (antes salía «(5)»).
  input.assigned = [item("1"), item("2")];
  input.overdue = [item("1")];
  input.comments = [{ ...item("1"), count: 2 }, item("2")];
  const digest = buildDigest(input);
  assert.equal(digest.taskCount, 2);
  const es = digestEmail(digest, { name: "Luz", baseUrl: "https://app.example.com", period: "sinceLast" }, makeT("es"));
  assert.equal(es.subject, "Tu resumen diario de Pizarro (2)");
  assert.match(es.text, /^Hola, Luz: esto ha pasado en tus proyectos desde el último resumen\./);
  for (const body of [es.text, es.html]) assert.ok(body.includes("No respondas a este email: contesta en Pizarro."));
  const en = digestEmail(digest, { name: "Luz", baseUrl: "https://app.example.com" }, makeT("en"));
  assert.match(en.text, /in the last 24 hours/);
  assert.ok(en.text.includes("Don't reply to this email: reply in Pizarro."));
  assert.match(en.html, /Don(&#39;|&#x27;|')t reply to this email: reply in Pizarro\./);
  const now = new Date("2026-11-21T08:00:00Z");
  assert.equal(digestPeriod(null, now), "24h");
  assert.equal(digestPeriod(new Date("2026-11-20T08:00:00Z"), now), "sinceLast");
  assert.equal(digestPeriod(new Date("2026-11-15T08:00:00Z"), now), "48h");
});

// --- Avisos ---

test("avisos: texto del cambio de fecha", () => {
  assert.equal(dueChangeExcerpt("2026-10-01", null), "2026-10-01>");
  assert.deepEqual(parseDueChange("2026-10-01>2026-10-05"), { from: "2026-10-01", to: "2026-10-05" });
  assert.deepEqual(parseDueChange(">2026-10-05"), { from: null, to: "2026-10-05" });
  assert.match(dueChangeText(">2026-10-05", makeT("en"), "en-US"), /^No date → Oct 5/);
});

test("avisos: email por tipo y preferencias", () => {
  const msg = { actorName: "Ana", taskTitle: "Pantalla", projectName: "Web", excerpt: "Hola", url: "https://a.b/p/1?task=2" };
  assert.match(mentionEmail({ ...msg, type: "ASSIGNED" }).subject, /Ana te ha asignado «Pantalla»/);
  assert.match(mentionEmail({ ...msg, type: "REPLY" }, makeT("en")).subject, /replied to your comment/);
  assert.match(mentionEmail({ ...msg, type: "DUE_CHANGED", excerpt: "2026-10-01>2026-10-05" }).text, /→/);
  // Un comentario (o una respuesta, o una mención) va como cita de quien lo ha escrito, separada de la cabecera: un
  // nombre o un texto no puede pasar por un mensaje de Pizarro.
  const comment = mentionEmail({ ...msg, type: "COMMENT", actorName: "Soporte <x>", excerpt: "Tu cuenta caduca hoy" });
  assert.ok(comment.text.startsWith("Soporte <x> ha comentado en «Pantalla» (Web)\n\nSoporte <x> ha escrito:\n> Tu cuenta caduca hoy\n\nAbrir la tarea: "), comment.text);
  assert.match(comment.html, /<p style="[^"]*">Soporte &lt;x&gt; ha escrito:<\/p>\n<blockquote[^>]*>Tu cuenta caduca hoy<\/blockquote>/);
  assert.match(mentionEmail({ ...msg, type: "REPLY" }, makeT("en")).text, /\n\nAna wrote:\n> Hola\n/);
  // El cambio de fecha no lo ha escrito nadie: sin «ha escrito».
  assert.doesNotMatch(mentionEmail({ ...msg, type: "DUE_CHANGED", excerpt: "2026-10-01>2026-10-05" }).text, /ha escrito/);
  // Enlace de baja al pie (texto y HTML), solo si lo hay.
  const unsub = mentionEmail({ ...msg, type: "MENTION" }, makeT("es"), { unsubscribeUrl: "https://a.b/unsubscribe/mX.y" });
  assert.match(unsub.text, /\nDejar de recibir estos emails: https:\/\/a\.b\/unsubscribe\/mX\.y\nNo respondas/);
  assert.match(unsub.html, /<a href="https:\/\/a\.b\/unsubscribe\/mX\.y"[^>]*>Dejar de recibir estos emails<\/a>/);
  assert.doesNotMatch(mentionEmail({ ...msg, type: "MENTION" }).text, /Dejar de recibir/);
  const prefs = { emailNotices: true, notifyEmail: true, notifyAssignedEmail: false, notifyDueEmail: true, notifyCommentEmail: false, notifyAdminEmail: true, dailyDigest: false };
  assert.equal(emailWanted("MENTION", prefs), true);
  assert.equal(emailWanted("ASSIGNED", prefs), false);
  assert.equal(emailWanted("DUE_CHANGED", prefs), true);
  assert.equal(emailWanted("COMMENT", prefs), false);
  assert.equal(emailWanted("REPLY", prefs), false);
  // Los recordatorios de «Esperando» van con las fechas límite (como en Telegram y WhatsApp), no con las menciones.
  assert.equal(emailWanted("WAITING", prefs), true);
  assert.equal(emailWanted("WAITING", { ...prefs, notifyEmail: true, notifyDueEmail: false }), false);
  // Administración (v1.79): su propia casilla, no la de las menciones; siempre al momento.
  const admin = ["PROJECT_TO_TEAM", "REPORT_UNSUBSCRIBED", "SHARE_REVOKED"] as const;
  for (const type of admin) {
    assert.equal(emailWanted(type, { ...prefs, notifyEmail: false }), true, type);
    assert.equal(emailWanted(type, { ...prefs, notifyAdminEmail: false }), false, type);
    assert.equal(emailWanted(type, { ...prefs, dailyDigest: true }), true, type);
  }
  // Con «Resumen diario», lo de proyectos marcado va en el resumen y no al momento.
  const digest = { ...prefs, dailyDigest: true, notifyAssignedEmail: true, notifyCommentEmail: true };
  for (const type of ["MENTION", "ASSIGNED", "DUE_CHANGED", "WAITING", "COMMENT", "REPLY"] as const) assert.equal(emailWanted(type, digest), false, type);
  // Casilla principal apagada: nada, ni administración.
  const all = { ...prefs, notifyAssignedEmail: true, notifyCommentEmail: true, emailNotices: false };
  for (const type of ["MENTION", "ASSIGNED", "DUE_CHANGED", "WAITING", "COMMENT", "REPLY", ...admin] as const) assert.equal(emailWanted(type, all), false, type);
});

// --- Menciones en el título ---

test("menciones: trozos de texto y etiquetas", () => {
  const text = `Hablar con ${mentionToken("Ana", "u1")} y ${mentionToken("Luis", "u2")}.`;
  assert.deepEqual(splitMentions(text), ["Hablar con ", { name: "Ana", id: "u1" }, " y ", { name: "Luis", id: "u2" }, "."]);
  assert.deepEqual(splitMentions("sin menciones"), ["sin menciones"]);
});

test("título: el límite de 210 cuenta el texto visible, no la mención guardada, y lo que sobra se recorta", () => {
  const mention = mentionToken("Ana", "cl1234567890abcdefghij123");
  assert.ok(mention.length > 30);
  assert.equal(taskTitle.safeParse(`${"a".repeat(200)} ${mention}`).success, true);
  // Más largo: no se rechaza, se recorta al máximo (ver title-clamp.test.ts).
  assert.equal(taskTitle.parse("a".repeat(211)), "a".repeat(210));
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
