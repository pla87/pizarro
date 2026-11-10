// Capturas reales de la app para la web del producto (getpizarro.com): rellena una base de datos de pruebas con
// datos de demostración (personas ficticias, emails @example.com), abre la app con Playwright y guarda las capturas
// en site/static/img/ (WebP a dos tamaños, tema claro y oscuro, en español y en inglés) más la imagen Open Graph
// (site/static/og.png y og-en.png). Después: `node scripts/build-site.mjs`.
//
// Cómo regenerarlas (unos 2 minutos; NUNCA contra una base de datos con datos reales: borra y crea datos de demo):
//   1. Base de datos vacía y propia, p. ej. pizarro_shots:
//        psql postgresql://postgres:postgres@localhost:5432/postgres -c 'create database pizarro_shots'
//      y en .env: DATABASE_URL=postgresql://postgres:postgres@localhost:5432/pizarro_shots
//   2. Build de producción y arranque inicial (crea el admin y los tipos generales):
//        npx prisma migrate deploy && npx next build --webpack && node scripts/postbuild.mjs && npm run build:boot
//        node --env-file-if-exists=.env dist/boot.mjs
//   3. Arranca la app:  npx next start -p 3252
//   4. Capturas:        node --env-file=.env scripts/site-screenshots.mjs [--base http://localhost:3252] [--only es]
//      Chromium: el de Playwright (variable CHROME o /opt/pw-browsers/...); playwright-core y sharp vienen en
//      node_modules. Para comprobar sin escribir en site/static: --out /tmp/capturas.
//   5. Borra la base de datos de pruebas.
//
// Las fechas son relativas a hoy (el calendario muestra el mes en curso). Los textos de la demo están aquí abajo
// (DEMO.es y DEMO.en); los de la interfaz son los de la app en el idioma de cada persona.
import { randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const arg = (name, def) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : def;
};
const BASE = arg("base", "http://localhost:3252").replace(/\/$/, "");
const OUT = arg("out", join(root, "site/static/img"));
const OG_OUT = arg("out", join(root, "site/static"));
const ONLY = arg("only", "");
const CHROME = process.env.CHROME || "/opt/pw-browsers/chromium-1243/chrome-linux64/chrome";
const PASSWORD = "demo-site-Pizarro-2026";

if (!process.env.DATABASE_URL) throw new Error("Falta DATABASE_URL (node --env-file=.env scripts/site-screenshots.mjs)");
if (/railway|amazonaws|rds\.|supabase|neon\.tech/.test(process.env.DATABASE_URL)) throw new Error("DATABASE_URL parece una base de datos real: usa una local de pruebas");

const { Client } = require("pg");
const bcrypt = require("bcryptjs");
const sharp = require("sharp");
const { chromium } = require("playwright-core");

const id = () => "d" + randomBytes(12).toString("hex");
const day = (n) => {
  const d = new Date();
  d.setUTCHours(12, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const ago = (hours) => new Date(Date.now() - hours * 3600_000).toISOString();
// Hora local de la demo (Madrid, CET en noviembre) n días antes de hoy.
const at = (n, hm) => new Date(`${day(n)}T${hm}:00+01:00`).toISOString();

// ---------------------------------------------------------------------------------------------------------------
// Datos de demostración. people[0] es quien hace las capturas. Columnas: índice en `columns`.
// kind: "F" Funcionalidad, "C" Corrección (tipos generales) o el nombre de un tipo del proyecto.
// ---------------------------------------------------------------------------------------------------------------
const DEMO = {
  es: {
    locale: "ES",
    people: [
      { key: "lucia", name: "Lucía Martín", email: "lucia@example.com" },
      { key: "carlos", name: "Carlos Ruiz", email: "carlos@example.com" },
      { key: "ana", name: "Ana Torres", email: "ana@example.com" },
      { key: "marcos", name: "Marcos Gil", email: "marcos@example.com" },
    ],
    shop: {
      name: "Tienda online",
      description: "La web de la tienda: catálogo, pagos y envíos.",
      columns: ["Por hacer", "En curso", "Revisión", ["Siguiente release", "NEXT_RELEASE"], ["Hecho", "IN_PRODUCTION"]],
      kinds: [{ name: "Mejora", color: "#0ea5e9" }],
      labels: { urgent: ["Urgente", "#ef4444"], design: ["Diseño", "#8b5cf6"], mobile: ["Móvil", "#14b8a6"], blocked: ["Bloqueado", "#f97316"] },
      header: ["Novedades de la versión", "## Novedades de esta versión\n\nEsto es lo que cambia en la tienda con esta versión."],
      footer: ["Contacto de soporte", "¿Algo no funciona como esperabas? Escríbenos a soporte@example.com."],
      tasks: [
        { col: 0, kind: "Mejora", title: "Programa de puntos para clientes habituales", who: "marcos" },
        { col: 0, kind: "C", title: "El cupón no se aplica con envío gratis", who: "carlos", due: 1, labels: ["urgent"] },
        { col: 0, kind: "F", title: "Pago con Bizum", who: "ana", due: 9, subtasks: [["Darse de alta con el banco", true], ["Integrar el pago", false], ["Probar devoluciones", false]] },
        { col: 0, kind: "Mejora", title: "Revisar los textos legales del pago", who: "marcos", due: 4 },
        {
          col: 1, kind: "F", title: "Nueva ficha de producto", who: "lucia", due: 6, labels: ["design"], priority: "ALTA", detail: true,
          description: "**Objetivo:** que la ficha muestre fotos grandes, las tallas disponibles y las opiniones de otros clientes.\n\n- Galería con zoom y fotos a pantalla completa\n- Tabla de tallas con stock en tiempo real\n- Opiniones con estrellas, de las más útiles a las más recientes\n\nDiseño aprobado en la reunión del lunes.",
          subtasks: [["Galería de fotos con zoom", true], ["Tabla de tallas", true], ["Opiniones de clientes", false], ["Revisar en el móvil", false]],
          comments: [
            { by: "ana", at: [-2, "09:42"], body: "He subido las fotos nuevas del catálogo a la carpeta del proyecto. @{lucia} ¿las usamos ya en la galería?" },
            { by: "lucia", at: [-2, "10:05"], reply: 0, body: "Sí, perfecto. Las pongo hoy y te aviso para que las revises." },
            { by: "carlos", at: [-1, "17:30"], body: "Ojo con el móvil: en pantallas pequeñas la tabla de tallas se sale por la derecha. Lo he dejado como subtarea." },
          ],
        },
        { col: 1, kind: "F", title: "Filtros por talla y color", who: "carlos", due: 12, subtasks: [["Filtro por talla", true], ["Filtro por color", false], ["Guardar los filtros en la URL", false]] },
        { col: 1, kind: "Mejora", title: "Acelerar la carga del catálogo", who: "ana", due: 3, labels: ["mobile"] },
        { col: 1, kind: "Mejora", title: "Fotos de la colección de invierno", who: "marcos", due: 8, subtasks: [["Sesión de fotos", true], ["Retocar y subir", false]] },
        { col: 2, kind: "F", title: "Recordatorio de carrito abandonado", who: "marcos", subtasks: [["Plantilla del email", true], ["Envío a las 24 horas", true], ["Enlace directo al carrito", true]] },
        { col: 2, kind: "C", title: "Fotos borrosas en la galería del móvil", who: "lucia", labels: ["mobile"] },
        {
          col: 3, kind: "F", title: "Seguimiento del envío en el email de confirmación", who: "ana",
          description: "El email de confirmación incluye el enlace de seguimiento de la empresa de transporte.",
        },
        { col: 3, kind: "F", title: "Buscador con sugerencias mientras escribes", who: "carlos", description: "Muestra productos y categorías desde la tercera letra." },
        { col: 3, kind: "C", title: "El total de la factura no sumaba los gastos de envío", who: "marcos" },
        { col: 3, kind: "Mejora", title: "Botón de compra más visible en el móvil", who: "lucia", labels: ["mobile"] },
        { col: 4, kind: "F", title: "R11F1: Pago con tarjeta en un solo paso", who: "ana", due: -4 },
        { col: 4, kind: "Mejora", title: "R11M1: Página de devoluciones más clara", who: "marcos", due: -6 },
        { col: 4, kind: "F", title: "R10F1: Cupones de descuento", who: "carlos", due: -8 },
        { col: 4, kind: "Mejora", title: "R10M1: Fotos más ligeras en el catálogo", who: "ana", due: -9 },
        { col: 2, kind: "Mejora", title: "Email de bienvenida para clientes nuevos", who: "ana", due: 5 },
      ],
      releases: [
        { n: 9, daysAgo: 30, title: "Release {d} · Tienda online", items: [["F", "Lista de deseos"], ["C", "El carrito se vaciaba al iniciar sesión"]] },
        { n: 10, daysAgo: 17, title: "Release {d} · Tienda online", items: [["F", "Cupones de descuento"], ["Mejora", "Fotos más ligeras en el catálogo"], ["C", "Error al cambiar la dirección de envío"]] },
        { n: 11, daysAgo: 4, title: "Release {d} · Tienda online", items: [["F", "Pago con tarjeta en un solo paso"], ["Mejora", "Página de devoluciones más clara"]] },
      ],
    },
    home: {
      name: "Casa",
      description: "Compras, citas y tareas de la familia.",
      columns: ["Por hacer", "Compras", "Citas", "Rutinas de la semana", ["Hecho", null, true]],
      kinds: [{ name: "Casa", color: "#22c55e" }, { name: "Compras", color: "#f59e0b" }, { name: "Cita", color: "#ec4899" }],
      tasks: [
        { col: 0, kind: "Casa", title: "Arreglar el grifo de la cocina", who: "carlos", due: 2 },
        { col: 0, kind: "Casa", title: "Renovar el seguro del coche", who: "lucia", due: 8 },
        { col: 1, kind: "Compras", title: "Compra del sábado", who: "lucia", due: 4, subtasks: [["Leche", true], ["Pan", false], ["Fruta", false], ["Detergente", false]] },
        { col: 2, kind: "Cita", title: "Revisión del dentista", who: "lucia", due: 7 },
        { col: 2, kind: "Cita", title: "Tutoría en el colegio", who: "carlos", due: 15 },
        { col: 3, kind: "Casa", title: "Sacar la basura", who: "carlos", due: 1 },
        { col: 4, kind: "Casa", title: "Pagar el recibo de la luz", who: "lucia", due: -5 },
        { col: 4, kind: "Cita", title: "Vacuna del perro", who: "carlos", due: -2 },
      ],
    },
    notifications: [
      { by: "ana", type: "MENTION", task: "Nueva ficha de producto", excerpt: "He subido las fotos nuevas del catálogo a la carpeta del proyecto. @Lucía Martín ¿las usamos ya en la galería?" },
      { by: "carlos", type: "COMMENT", task: "Nueva ficha de producto", excerpt: "Ojo con el móvil: en pantallas pequeñas la tabla de tallas se sale por la derecha." },
    ],
  },
  en: {
    locale: "EN",
    people: [
      { key: "lucia", name: "Emma Clarke", email: "emma@example.com" },
      { key: "carlos", name: "James Patel", email: "james@example.com" },
      { key: "ana", name: "Sofia Rossi", email: "sofia@example.com" },
      { key: "marcos", name: "Daniel Brooks", email: "daniel@example.com" },
    ],
    shop: {
      name: "Online shop",
      description: "The shop's website: catalogue, payments and shipping.",
      columns: ["To do", "In progress", "Review", ["Next release", "NEXT_RELEASE"], ["Done", "IN_PRODUCTION"]],
      kinds: [{ name: "Improvement", color: "#0ea5e9" }],
      labels: { urgent: ["Urgent", "#ef4444"], design: ["Design", "#8b5cf6"], mobile: ["Mobile", "#14b8a6"], blocked: ["Blocked", "#f97316"] },
      header: ["Release highlights", "## What's new in this version\n\nHere is what changes in the shop with this release."],
      footer: ["Support contact", "Something not working as expected? Write to us at support@example.com."],
      tasks: [
        { col: 0, kind: "Improvement", title: "Loyalty points for returning customers", who: "marcos" },
        { col: 0, kind: "C", title: "Coupon not applied with free shipping", who: "carlos", due: 1, labels: ["urgent"] },
        { col: 0, kind: "F", title: "Pay with Apple Pay", who: "ana", due: 9, subtasks: [["Sign up with the bank", true], ["Integrate the payment", false], ["Test refunds", false]] },
        { col: 0, kind: "Improvement", title: "Review the checkout legal texts", who: "marcos", due: 4 },
        {
          col: 1, kind: "F", title: "New product page", who: "lucia", due: 6, labels: ["design"], priority: "ALTA", detail: true,
          description: "**Goal:** a product page with large photos, the sizes in stock and reviews from other customers.\n\n- Gallery with zoom and full-screen photos\n- Size chart with live stock\n- Star reviews, most helpful first\n\nDesign approved at Monday's meeting.",
          subtasks: [["Photo gallery with zoom", true], ["Size chart", true], ["Customer reviews", false], ["Check on mobile", false]],
          comments: [
            { by: "ana", at: [-2, "09:42"], body: "I've uploaded the new catalogue photos to the project folder. @{lucia} shall we use them in the gallery?" },
            { by: "lucia", at: [-2, "10:05"], reply: 0, body: "Yes, great. I'll add them today and let you know so you can review them." },
            { by: "carlos", at: [-1, "17:30"], body: "Careful on mobile: on small screens the size chart overflows to the right. I've added it as a subtask." },
          ],
        },
        { col: 1, kind: "F", title: "Filter by size and colour", who: "carlos", due: 12, subtasks: [["Size filter", true], ["Colour filter", false], ["Keep filters in the URL", false]] },
        { col: 1, kind: "Improvement", title: "Faster catalogue loading", who: "ana", due: 3, labels: ["mobile"] },
        { col: 1, kind: "Improvement", title: "Winter collection photos", who: "marcos", due: 8, subtasks: [["Photo shoot", true], ["Retouch and upload", false]] },
        { col: 2, kind: "F", title: "Abandoned cart reminder", who: "marcos", subtasks: [["Email template", true], ["Send after 24 hours", true], ["Direct link to the cart", true]] },
        { col: 2, kind: "C", title: "Blurry photos in the mobile gallery", who: "lucia", labels: ["mobile"] },
        { col: 3, kind: "F", title: "Shipment tracking in the confirmation email", who: "ana", description: "The confirmation email includes the carrier's tracking link." },
        { col: 3, kind: "F", title: "Search suggestions as you type", who: "carlos", description: "Shows products and categories from the third letter." },
        { col: 3, kind: "C", title: "Invoice total left out the shipping cost", who: "marcos" },
        { col: 3, kind: "Improvement", title: "More visible buy button on mobile", who: "lucia", labels: ["mobile"] },
        { col: 4, kind: "F", title: "R11F1: One-step card payment", who: "ana", due: -4 },
        { col: 4, kind: "Improvement", title: "R11I1: Clearer returns page", who: "marcos", due: -6 },
        { col: 4, kind: "F", title: "R10F1: Discount coupons", who: "carlos", due: -8 },
        { col: 4, kind: "Improvement", title: "R10I1: Lighter catalogue photos", who: "ana", due: -9 },
        { col: 2, kind: "Improvement", title: "Welcome email for new customers", who: "ana", due: 5 },
      ],
      releases: [
        { n: 9, daysAgo: 30, title: "Release {d} · Online shop", items: [["F", "Wish list"], ["C", "Cart emptied on sign-in"]] },
        { n: 10, daysAgo: 17, title: "Release {d} · Online shop", items: [["F", "Discount coupons"], ["Improvement", "Lighter catalogue photos"], ["C", "Error changing the shipping address"]] },
        { n: 11, daysAgo: 4, title: "Release {d} · Online shop", items: [["F", "One-step card payment"], ["Improvement", "Clearer returns page"]] },
      ],
    },
    home: {
      name: "Home",
      description: "Shopping, appointments and family chores.",
      columns: ["To do", "Shopping", "Appointments", "Weekly routines", ["Done", null, true]],
      kinds: [{ name: "Home", color: "#22c55e" }, { name: "Shopping", color: "#f59e0b" }, { name: "Appointment", color: "#ec4899" }],
      tasks: [
        { col: 0, kind: "Home", title: "Fix the kitchen tap", who: "carlos", due: 2 },
        { col: 0, kind: "Home", title: "Renew the car insurance", who: "lucia", due: 8 },
        { col: 1, kind: "Shopping", title: "Saturday shopping", who: "lucia", due: 4, subtasks: [["Milk", true], ["Bread", false], ["Fruit", false], ["Detergent", false]] },
        { col: 2, kind: "Appointment", title: "Dentist check-up", who: "lucia", due: 7 },
        { col: 2, kind: "Appointment", title: "Parent-teacher meeting", who: "carlos", due: 15 },
        { col: 3, kind: "Home", title: "Take out the rubbish", who: "carlos", due: 1 },
        { col: 4, kind: "Home", title: "Pay the electricity bill", who: "lucia", due: -5 },
        { col: 4, kind: "Appointment", title: "Vet appointment for the dog", who: "carlos", due: -2 },
      ],
    },
    notifications: [
      { by: "ana", type: "MENTION", task: "New product page", excerpt: "I've uploaded the new catalogue photos to the project folder. @Emma Clarke shall we use them in the gallery?" },
      { by: "carlos", type: "COMMENT", task: "New product page", excerpt: "Careful on mobile: on small screens the size chart overflows to the right." },
    ],
  },
};

// ---------------------------------------------------------------------------------------------------------------
// Siembra (SQL directo: borra la demo anterior y la vuelve a crear)
// ---------------------------------------------------------------------------------------------------------------
async function seed(db, demo) {
  const emails = demo.people.map((p) => p.email);
  const old = await db.query(`SELECT DISTINCT "projectId" FROM "ProjectMember" m JOIN "User" u ON u.id = m."userId" WHERE u.email = ANY($1)`, [emails]);
  for (const r of old.rows) await db.query(`DELETE FROM "Project" WHERE id = $1`, [r.projectId]);
  await db.query(`DELETE FROM "User" WHERE email = ANY($1)`, [emails]);

  const hash = await bcrypt.hash(PASSWORD, 10);
  const users = {};
  for (const p of demo.people) {
    users[p.key] = { ...p, id: id() };
    await db.query(
      `INSERT INTO "User" (id, email, name, "passwordHash", role, locale, "updatedAt") VALUES ($1,$2,$3,$4,'MEMBER',$5,now())`,
      [users[p.key].id, p.email, p.name, hash, demo.locale],
    );
  }
  const mention = (text) => text.replace(/@\{(\w+)\}/g, (_, k) => `@[${users[k].name}](user:${users[k].id})`);
  const taskIds = {};

  async function project(def, pos, { withReleases }) {
    const pid = id();
    await db.query(`INSERT INTO "Project" (id, name, description, position, "taskFields", "updatedAt") VALUES ($1,$2,$3,$4,$5,now())`, [pid, def.name, def.description, pos, ["priority"]]);
    for (const u of Object.values(users)) await db.query(`INSERT INTO "ProjectMember" ("projectId","userId") VALUES ($1,$2)`, [pid, u.id]);
    await db.query(`INSERT INTO "ProjectHiddenKind" ("projectId","kindId") VALUES ($1,'kind_respuesta')`, [pid]);
    if (!withReleases) {
      await db.query(`INSERT INTO "ProjectHiddenKind" ("projectId","kindId") VALUES ($1,'kind_funcionalidad'),($1,'kind_correccion')`, [pid]);
    }
    const cols = [];
    for (const [i, c] of def.columns.entries()) {
      const [name, role, done] = Array.isArray(c) ? c : [c];
      const cid = id();
      cols.push(cid);
      await db.query(`INSERT INTO "Column" (id,"projectId",name,position,role,"isDone") VALUES ($1,$2,$3,$4,$5,$6)`, [cid, pid, name, i + 1, role ?? "NONE", Boolean(done) || role === "IN_PRODUCTION"]);
    }
    const kinds = { F: "kind_funcionalidad", C: "kind_correccion" };
    for (const [i, k] of def.kinds.entries()) {
      kinds[k.name] = id();
      await db.query(`INSERT INTO "TaskKind" (id,name,color,position,"projectId") VALUES ($1,$2,$3,$4,$5)`, [kinds[k.name], k.name, k.color, 10 + i, pid]);
    }
    const labels = {};
    for (const [key, [name, color]] of Object.entries(def.labels ?? {})) {
      labels[key] = id();
      await db.query(`INSERT INTO "Label" (id,"projectId",name,color) VALUES ($1,$2,$3,$4)`, [labels[key], pid, name, color]);
    }
    if (def.header) {
      // Plantillas de quien hace las capturas: las primeras se proponen al generar la release.
      await db.query(`INSERT INTO "ReleaseTemplate" (id,"userId",kind,name,content,position) VALUES ($1,$2,'HEADER',$3,$4,1)`, [id(), users.lucia.id, ...def.header]);
      await db.query(`INSERT INTO "ReleaseTemplate" (id,"userId",kind,name,content,position) VALUES ($1,$2,'FOOTER',$3,$4,1)`, [id(), users.lucia.id, ...def.footer]);
    }
    const perCol = {};
    for (const t of def.tasks) {
      const tid = id();
      taskIds[t.title] = tid;
      perCol[t.col] = (perCol[t.col] ?? 0) + 1;
      const who = t.who ? users[t.who].id : null;
      await db.query(
        `INSERT INTO "Task" (id,"projectId","columnId",title,description,"kindId",position,"assigneeId","createdById","dueDate",priority,"columnEnteredAt","createdAt","updatedAt")
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$12,now())`,
        [tid, pid, cols[t.col], t.title, t.description ?? "", kinds[t.kind], perCol[t.col] * 1000, who, users.lucia.id, t.due == null ? null : day(t.due), t.priority ?? null, ago(48 + perCol[t.col])],
      );
      for (const l of t.labels ?? []) await db.query(`INSERT INTO "TaskLabel" ("taskId","labelId") VALUES ($1,$2)`, [tid, labels[l]]);
      for (const [i, [title, done]] of (t.subtasks ?? []).entries()) {
        await db.query(`INSERT INTO "Subtask" (id,"taskId",title,done,position) VALUES ($1,$2,$3,$4,$5)`, [id(), tid, title, done, (i + 1) * 1000]);
      }
      const commentIds = [];
      for (const c of t.comments ?? []) {
        const cid = id();
        commentIds.push(cid);
        await db.query(`INSERT INTO "TaskComment" (id,"taskId","authorId",body,"createdAt","parentId") VALUES ($1,$2,$3,$4,$5,$6)`, [cid, tid, users[c.by].id, mention(c.body), at(...c.at), c.reply == null ? null : commentIds[c.reply]]);
      }
      const followers = new Set([users.lucia.id, who, ...(t.comments ?? []).map((c) => users[c.by].id)].filter(Boolean));
      for (const f of followers) await db.query(`INSERT INTO "TaskFollower" ("taskId","userId") VALUES ($1,$2)`, [tid, f]);
    }
    if (withReleases) {
      const kindName = (k) => (k === "F" ? "Funcionalidad" : k === "C" ? "Corrección" : k);
      const label = (k) => (demo.locale === "EN" ? { F: "Feature", C: "Bug fix" }[k] ?? k : kindName(k));
      for (const r of def.releases) {
        const rid = id();
        const date = day(-r.daysAgo);
        const groups = {};
        for (const [k, title] of r.items) (groups[k] ??= []).push(title);
        const content = [def.header[1], ...Object.entries(groups).map(([k, titles]) => `### ${label(k)}\n` + titles.map((ti, i) => `- **R${r.n}${label(k)[0]}${i + 1}** · ${ti}`).join("\n")), def.footer[1]].join("\n\n");
        await db.query(`INSERT INTO "Release" (id,"projectId",number,title,content,"createdById","deployedAt") VALUES ($1,$2,$3,$4,$5,$6,$7)`, [rid, pid, r.n, r.title.replace("{d}", date), content, users.lucia.id, `${date}T16:30:00Z`]);
        for (const [k, title] of r.items) await db.query(`INSERT INTO "ReleaseTask" (id,"releaseId",title,"kindName") VALUES ($1,$2,$3,$4)`, [id(), rid, title, kindName(k)]);
      }
    }
    return pid;
  }

  const shop = await project(demo.shop, 1, { withReleases: true });
  const home = await project({ ...demo.home, labels: {} }, 2, { withReleases: false });
  for (const [i, n] of demo.notifications.entries()) {
    await db.query(`INSERT INTO "Notification" (id,"userId","actorId",type,"taskId",excerpt,"createdAt") VALUES ($1,$2,$3,$4,$5,$6,$7)`, [id(), users.lucia.id, users[n.by].id, n.type, taskIds[n.task], n.excerpt, ago(3 + i * 20)]);
  }
  return { shop, home, detailTask: taskIds[demo.shop.tasks.find((t) => t.detail).title], user: users.lucia };
}

// ---------------------------------------------------------------------------------------------------------------
// Capturas
// ---------------------------------------------------------------------------------------------------------------
const shots = []; // para el resumen final

/** Guarda una captura como WebP en dos anchos (el grande = 2x del tamaño en la web). */
async function save(png, name, widths) {
  console.log(`  ${name}`);
  mkdirSync(OUT, { recursive: true });
  for (const w of widths) {
    const file = join(OUT, `${name}-${w}.webp`);
    const img = sharp(png).resize({ width: w, withoutEnlargement: true });
    const buf = await img.webp({ quality: 82, effort: 6, smartSubsample: true }).toBuffer();
    writeFileSync(file, buf);
    const meta = await sharp(buf).metadata();
    shots.push(`${file.replace(root + "/", "")}  ${meta.width}x${meta.height}  ${Math.round(buf.length / 1024)} KB`);
  }
}

async function login(page, email) {
  await page.goto(`${BASE}/login`);
  await page.fill('input[type="email"], input[name="email"]', email);
  await page.fill('input[type="password"]', PASSWORD);
  await Promise.all([page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 20000 }), page.press('input[type="password"]', "Enter")]);
}

/** Espera a que la página esté quieta: red, fuentes y sin animaciones. */
async function settle(page, ms = 600) {
  // El canal en vivo mantiene una conexión abierta: «networkidle» no llega nunca, así que se espera poco.
  await page.waitForLoadState("networkidle", { timeout: 2500 }).catch(() => {});
  await page.evaluate(() => document.fonts?.ready);
  await page.waitForTimeout(ms);
}

const NO_MOTION = `*, *::before, *::after { transition: none !important; animation: none !important; caret-color: transparent !important; }`;

const DESKTOP = { width: 1600, height: 960 };
const BOARD = { width: 1780, height: 900 };
const PHONE = { width: 390, height: 844 };

async function open(page, url, wait = 1200) {
  await page.goto(url);
  await page.addStyleTag({ content: NO_MOTION });
  await settle(page, wait);
}

/** Recorte alrededor de un elemento (p. ej. un diálogo), con un margen del fondo, dentro de la ventana. */
async function around(page, locator, margin) {
  const r = await locator.boundingBox();
  const vp = page.viewportSize();
  const x = Math.max(0, r.x - margin);
  const y = Math.max(0, r.y - margin);
  return { x, y, width: Math.min(vp.width, r.x + r.width + margin) - x, height: Math.min(vp.height, r.y + r.height + margin) - y };
}

async function capture(browser, lang, ctx) {
  const isEs = lang === "es";
  const common = { locale: isEs ? "es-ES" : "en-GB", timezoneId: "Europe/Madrid", reducedMotion: "reduce", deviceScaleFactor: 2 };
  for (const scheme of ["light", "dark"]) {
    const sfx = `${lang}-${scheme}`;
    // Escritorio
    const desk = await browser.newContext({ ...common, viewport: DESKTOP, colorScheme: scheme });
    const page = await desk.newPage();
    page.on("dialog", (d) => d.accept().catch(() => {}));
    await login(page, ctx.user.email);

    // Tablero (la imagen principal): más ancho para que quepan las cinco columnas
    await page.setViewportSize(BOARD);
    await open(page, `${BASE}/p/${ctx.shop}`);
    await save(await page.screenshot(), `board-${sfx}`, [1280, 2400]);
    await page.setViewportSize(DESKTOP);

    // Detalle de una tarea (modal sobre el tablero)
    await open(page, `${BASE}/p/${ctx.shop}?task=${ctx.detailTask}`, 1500);
    await save(await page.screenshot({ clip: await around(page, page.getByRole("dialog").last(), 32) }), `task-${sfx}`, [1100, 2000]);

    // Comentarios con una mención a medio escribir (recorte del detalle)
    const comments = page.locator("section", { has: page.getByRole("heading", { name: isEs ? /^Comentarios/ : /^Comments/ }) }).last();
    await comments.scrollIntoViewIfNeeded();
    const box = comments.locator("textarea, [contenteditable=true]").last();
    await box.evaluate((el) => el.setAttribute("spellcheck", "false"));
    await box.click();
    await page.keyboard.type(isEs ? "Perfecto, gracias. @Car" : "Great, thanks. @Jam", { delay: 30 });
    await settle(page, 900);
    const list = page.getByRole("listbox").last();
    if (await list.count()) await list.scrollIntoViewIfNeeded();
    await settle(page, 300);
    const r = await comments.boundingBox();
    const lb = (await list.count()) ? await list.boundingBox() : null;
    const pad = 16;
    const top = Math.max(0, r.y - pad);
    const dlg = await page.getByRole("dialog").last().boundingBox().catch(() => null);
    const bottom = Math.min(DESKTOP.height, dlg ? dlg.y + dlg.height - 2 : DESKTOP.height, Math.max(r.y + r.height, lb ? lb.y + lb.height : 0) + 10);
    const clip = { x: r.x - pad, y: top, width: r.width + pad * 2, height: bottom - top };
    await save(await page.screenshot({ clip }), `comments-${sfx}`, [760, 1400]);
    // Sin borrador pendiente (si no, el navegador pregunta al salir de la página)
    await box.fill("", { timeout: 5000 }).catch(() => {});

    // Release notes generadas: «Generar release» en la columna de la siguiente release, paso 2
    await open(page, `${BASE}/p/${ctx.shop}`, 800);
    await page.getByRole("button", { name: isEs ? /Generar Release/ : /Generate release/ }).first().click();
    await settle(page, 800);
    await page.getByRole("button", { name: isEs ? /Generar con \d+/ : /Generate with \d+/ }).click();
    await settle(page, 1200);
    // El texto en Markdown (pestaña «Editar»): se ven los códigos R12F1… tal como se copian
    await save(await page.screenshot({ clip: await around(page, page.getByRole("dialog").last(), 40) }), `release-${sfx}`, [1100, 2000]);

    // Calendario
    await open(page, `${BASE}/calendar`);
    await save(await page.screenshot(), `calendar-${sfx}`, [1280, 2400]);
    await desk.close();

    // Móvil
    const mob = await browser.newContext({ ...common, viewport: PHONE, isMobile: true, hasTouch: true, colorScheme: scheme });
    const m = await mob.newPage();
    m.on("dialog", (d) => d.accept().catch(() => {}));
    await login(m, ctx.user.email);
    await open(m, `${BASE}/p/${ctx.shop}`);
    const tab = m.locator("button, [role=tab]").filter({ hasText: isEs ? /^\s*En curso/ : /^\s*In progress/ }).first();
    if (await tab.count()) await tab.click();
    await settle(m, 800);
    await save(await m.screenshot(), `mobile-board-${sfx}`, [390, 780]);
    await open(m, `${BASE}/p/${ctx.shop}?task=${ctx.detailTask}`, 1500);
    await save(await m.screenshot(), `mobile-task-${sfx}`, [390, 780]);
    await mob.close();
  }
}

/** Imagen Open Graph (1200x630) hecha con la captura real del tablero. */
async function ogImage(browser, lang) {
  const isEs = lang === "es";
  const img = await sharp(join(OUT, `board-${lang}-light-2400.webp`)).png().toBuffer();
  const title = isEs ? "El tablero Kanban sencillo, en tu propio servidor." : "The simple Kanban board, on your own server.";
  const sub = isEs ? "Para equipos pequeños y familias · Pago único · Gratis para uso personal" : "For small teams and families · One-off payment · Free for personal use";
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
    html,body{margin:0;width:1200px;height:630px;overflow:hidden;font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
    body{background:radial-gradient(1200px 500px at 85% -10%,#6366f1 0,transparent 60%),linear-gradient(135deg,#1e1b4b 0%,#312e81 55%,#4338ca 100%);color:#fff;position:relative}
    .t{position:absolute;left:64px;top:64px;width:560px}
    .b{display:flex;align-items:center;gap:14px;font-weight:800;font-size:30px;letter-spacing:-.01em}
    h1{font-size:50px;line-height:1.08;letter-spacing:-.03em;margin:34px 0 22px;font-weight:800}
    p{font-size:22px;line-height:1.45;color:#c7d2fe;margin:0}
    .shot{position:absolute;left:660px;top:92px;width:900px;border-radius:14px;box-shadow:0 30px 80px rgba(0,0,0,.45);border:1px solid rgba(255,255,255,.18);overflow:hidden;background:#fff}
    .shot img{display:block;width:100%}
  </style></head><body>
  <div class="t"><div class="b"><svg viewBox="0 0 32 32" width="44" height="44"><rect width="32" height="32" rx="7" fill="#fff"/><rect x="6" y="7" width="5.5" height="18" rx="1.5" fill="#4f46e5"/><rect x="13.25" y="7" width="5.5" height="12" rx="1.5" fill="#818cf8"/><rect x="20.5" y="7" width="5.5" height="7" rx="1.5" fill="#a5b4fc"/></svg>Pizarro</div>
  <h1>${title}</h1><p>${sub}</p></div>
  <div class="shot"><img src="data:image/png;base64,${img.toString("base64")}"></div>
  </body></html>`;
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  await page.setContent(html);
  await page.waitForTimeout(300);
  const png = await page.screenshot();
  await ctx.close();
  const file = join(OG_OUT, isEs ? "og.png" : "og-en.png");
  writeFileSync(file, await sharp(png).png({ compressionLevel: 9, palette: false }).toBuffer());
  shots.push(file.replace(root + "/", ""));
}

const db = new Client({ connectionString: process.env.DATABASE_URL });
await db.connect();
try {
  for (const lang of ["es", "en"]) {
    if (ONLY && ONLY !== lang) continue;
    const ctx = await seed(db, DEMO[lang]);
    // Un navegador por idioma: --lang fija también el formato de los campos de fecha.
    const lc = lang === "es" ? "es_ES" : "en_GB";
    const browser = await chromium.launch({ executablePath: CHROME, args: [`--lang=${lc.replace("_", "-")}`], env: { ...process.env, LANG: `${lc}.UTF-8`, LANGUAGE: lc, LC_ALL: `${lc}.UTF-8` } });
    try {
      await capture(browser, lang, ctx);
      await ogImage(browser, lang);
    } finally {
      await browser.close();
    }
  }
} finally {
  await db.end();
}
console.log(`Capturas:\n  ${shots.join("\n  ")}`);
