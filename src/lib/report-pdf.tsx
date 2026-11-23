// Documentos PDF (@react-pdf/renderer). Este módulo solo se carga en el worker de PDF (report-pdf-worker.ts): el
// proceso web importa de aquí únicamente tipos, así @react-pdf/renderer no entra en el servidor de Next.
import { Children, cloneElement, Fragment, isValidElement, type ReactElement, type ReactNode } from "react";
import { Document, Font, Link, Page, pdf, StyleSheet, Text, View } from "@react-pdf/renderer";
import { intlLocale, makeT, type Locale, type T } from "@/i18n/core";
import { weekRangeEnds } from "./calendar";
import { formatDay } from "./dates";
import type { ChecklistGroup, ChecklistGroupBy } from "./checklist";
import { ASSIGN_PLAN_LABEL, PLAN_SUBTASKS_SHOWN, type AssignPlanPdfInput, type AssignPlanTask } from "./column-assign-core";
import { programBlocks, type ProgramPdfDocument, type ProgramPdfInput } from "./course-program";
import type { PdfBlock, PdfRun } from "./pdf-markdown";
import type { WeekPlanGroupBy, WeekPlanSection, WeekPlanTask } from "./week-plan";
import { RECENT_DONE_DAYS, UPCOMING_DAYS, type DeliverableStatus, type Report, type ReportFieldRow, type ReportTask } from "./report";
import { formatEuro, formatHours, PRIORITY_LABEL } from "./task-fields";
import { pdfSafeData, pdfWordParts } from "./pdf-text";
import { chunkBlocks, PDF_CHUNK_UNITS, PDF_SINGLE_PAGE_UNITS, pickCut, textUnits, totalUnits, type PdfBlockSize } from "./pdf-chunks";

// Sin partición de palabras por sílabas (en español quedaba «re-sumen»), salvo las palabras muy largas (URLs, textos
// sin espacios), que se pueden cortar en trozos para no salirse de la celda ni de la página.
Font.registerHyphenationCallback(pdfWordParts);

const C = {
  text: "#0f172a",
  muted: "#64748b",
  line: "#e2e8f0",
  soft: "#f8fafc",
  brand: "#4f46e5",
  brandSoft: "#eef2ff",
  // Verde y ámbar 700 (5,5:1 y 5:1 con blanco): las etiquetas de estado van en blanco sobre ellos, a 7 pt, y también se
  // usan como color de texto sobre el blanco de la página. Con los 600 se quedaban en 3,8:1 y 3,2:1.
  green: "#047857",
  amber: "#b45309",
  red: "#dc2626",
};

const STATUS_COLOR: Record<DeliverableStatus, string> = {
  Completado: C.green,
  "En plazo": C.brand,
  "En riesgo": C.amber,
  Retrasado: C.red,
  "Sin fecha": C.muted,
  // Gris medio y no el claro (2,6:1 con el blanco de la etiqueta).
  "Sin tareas": C.muted,
};

const s = StyleSheet.create({
  // Sin interlineado en la página: el pie fijo lo hereda y @react-pdf calcula mal la paginación de los documentos largos
  // («unsupported number» a partir de ~150 filas, y el pie no se pintaba). Las filas ya llevan su relleno.
  page: { paddingTop: 36, paddingBottom: 48, paddingHorizontal: 36, fontFamily: "Helvetica", fontSize: 9, color: C.text },
  header: { borderBottomWidth: 2, borderBottomColor: C.brand, paddingBottom: 10, marginBottom: 14 },
  eyebrow: { fontSize: 8, color: C.brand, fontFamily: "Helvetica-Bold", letterSpacing: 1, textTransform: "uppercase" },
  title: { fontSize: 20, lineHeight: 1.2, fontFamily: "Helvetica-Bold", marginTop: 4 },
  meta: { fontSize: 8.5, color: C.muted, marginTop: 3 },
  desc: { fontSize: 9, color: C.muted, marginTop: 6 },
  h2: { fontSize: 12.5, fontFamily: "Helvetica-Bold", color: "#312e81", marginTop: 16, marginBottom: 6 },
  h3: { fontSize: 10.5, fontFamily: "Helvetica-Bold", marginTop: 10, marginBottom: 4 },
  kpis: { flexDirection: "row", gap: 6 },
  kpi: { flex: 1, borderWidth: 1, borderColor: C.line, borderRadius: 6, padding: 7, backgroundColor: C.soft },
  kpiValue: { fontSize: 16, lineHeight: 1.2, fontFamily: "Helvetica-Bold" },
  kpiLabel: { fontSize: 7.5, color: C.muted, marginTop: 1 },
  barTrack: { height: 6, backgroundColor: C.line, borderRadius: 3, overflow: "hidden" },
  barFill: { height: 6, backgroundColor: C.brand },
  table: { borderWidth: 1, borderColor: C.line, borderRadius: 4 },
  tr: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: C.line, minHeight: 16, alignItems: "center" },
  trLast: { flexDirection: "row", minHeight: 16, alignItems: "center" },
  th: { backgroundColor: C.brandSoft, fontFamily: "Helvetica-Bold", color: "#312e81", fontSize: 8 },
  td: { paddingVertical: 3, paddingHorizontal: 5 },
  small: { fontSize: 7.5, color: C.muted },
  pill: { fontSize: 7, fontFamily: "Helvetica-Bold", paddingVertical: 1.5, paddingHorizontal: 4, borderRadius: 3, color: "#fff" },
  footer: { position: "absolute", bottom: 20, left: 36, right: 36, flexDirection: "row", justifyContent: "space-between", fontSize: 7.5, color: C.muted },
});

function Bar({ value, color = C.brand }: { value: number; color?: string }) {
  return (
    <View style={s.barTrack}>
      <View style={[s.barFill, { width: `${Math.max(0, Math.min(100, value))}%`, backgroundColor: color }]} />
    </View>
  );
}

interface Ctx {
  t: T;
  locale: string;
}

function dueLabel(t: { dueDate: string | null; daysLeft: number | null; done?: boolean }, today: string, x: Ctx): string {
  if (!t.dueDate) return "—";
  const date = formatDay(t.dueDate, today, x.locale);
  if (t.done || t.daysLeft === null) return date;
  if (t.daysLeft < 0) return `${date} ${x.t("(hace {n} d)", { n: (-t.daysLeft).toLocaleString(x.locale) })}`;
  if (t.daysLeft === 0) return `${date} ${x.t("(hoy)")}`;
  return `${date} ${x.t("(en {n} d)", { n: t.daysLeft.toLocaleString(x.locale) })}`;
}

function dueColor(t: ReportTask): string {
  if (t.done || t.daysLeft === null) return C.text;
  if (t.daysLeft < 0) return C.red;
  if (t.daysLeft <= 3) return C.amber;
  return C.text;
}

interface Col<T> {
  label: string;
  width: string;
  render: (row: T) => React.ReactNode;
}

/**
 * Trozo de una tabla partida en bloques (documentos largos, ver tableBlocks): «first» lleva la cabecera y el borde de
 * arriba, «last» el de abajo y «middle» solo los laterales. Uno debajo de otro se ven como la tabla entera.
 */
type TablePart = "only" | "first" | "middle" | "last";

const TABLE_PART_STYLE = {
  only: s.table,
  first: { ...s.table, borderBottomWidth: 0, borderBottomLeftRadius: 0, borderBottomRightRadius: 0 },
  middle: { borderLeftWidth: 1, borderRightWidth: 1, borderColor: C.line },
  last: { ...s.table, borderTopWidth: 0, borderTopLeftRadius: 0, borderTopRightRadius: 0 },
};

/** Tabla sin cabecera suelta: la cabecera viaja junto a las primeras filas y ninguna fila se parte. */
function Table<T>({ cols, rows, part = "only", "data-pz": tag }: { cols: Col<T>[]; rows: T[]; part?: TablePart; "data-pz"?: number }) {
  if (!rows.length) return null;
  const closes = part === "only" || part === "last";
  const head = (
    <View style={[s.tr, s.th]}>
      {cols.map((c) => (
        <Text key={c.label} style={[s.td, { width: c.width }]}>{c.label}</Text>
      ))}
    </View>
  );
  const row = (r: T, i: number) => (
    <View key={i} style={closes && i === rows.length - 1 ? s.trLast : s.tr} wrap={false}>
      {cols.map((c) => {
        const v = c.render(r);
        return (
          <View key={c.label} style={[s.td, { width: c.width }]}>
            {typeof v === "string" || typeof v === "number" ? <Text>{v}</Text> : v}
          </View>
        );
      })}
    </View>
  );
  if (part === "middle" || part === "last") return <View style={TABLE_PART_STYLE[part]} data-pz={tag}>{rows.map(row)}</View>;
  const HEAD_ROWS = 2;
  return (
    <View style={TABLE_PART_STYLE[part]} data-pz={tag}>
      <View wrap={false}>
        {head}
        {rows.slice(0, HEAD_ROWS).map((r, i) => row(r, i))}
      </View>
      {rows.slice(HEAD_ROWS).map((r, i) => row(r, i + HEAD_ROWS))}
    </View>
  );
}

// --- Documentos largos en tramos (ver pdf-chunks.ts) ---------------------------------------------------------------------

/** Trozo de un documento: uno o varios hijos directos de <Page> (con <>…</>) y su tamaño estimado. */
interface Block extends PdfBlockSize {
  node: React.ReactNode;
}

/** Tamaño de una fila de tabla: sus líneas en la columna del título (`chars` caracteres por línea). */
const rowUnits = (text: string, chars: number) => 0.4 + textUnits(text, chars);

/**
 * En un documento largo, las tablas y listas van fila a fila (un bloque por fila: así casi cualquier salto de página
 * cae entre dos bloques, ver pickCut), salvo las primeras, que van con su título para que no se quede solo al pie.
 */
const HEAD_BLOCK_ROWS = 5;

/** Filas en bloques: las HEAD_BLOCK_ROWS primeras juntas y luego de una en una (documento largo); si no, todas juntas. */
const rowRuns = <T,>(rows: T[], big: boolean): T[][] =>
  big && rows.length > HEAD_BLOCK_ROWS + 1 ? [rows.slice(0, HEAD_BLOCK_ROWS), ...rows.slice(HEAD_BLOCK_ROWS).map((r) => [r])] : [rows];

/**
 * Una tabla en bloques. En un documento corto (`big` falso), un solo bloque: `wrap(<Table/>, true, true)`, como siempre.
 * En uno largo, en trozos (ver rowRuns; el primero con la cabecera) que, uno debajo de otro, se ven como la tabla entera.
 * `wrap(tabla, primero, último)` añade lo que va alrededor (el título de la sección, el margen de después).
 */
function tableBlocks<T>(
  rows: T[], cols: Col<T>[], units: (r: T) => number, big: boolean,
  wrap: (table: React.ReactNode, first: boolean, last: boolean) => React.ReactNode, leadUnits = 0,
): Block[] {
  const runs = rowRuns(rows, big);
  return runs.map((run, i) => {
    const last = i === runs.length - 1;
    const part: TablePart = runs.length === 1 ? "only" : i === 0 ? "first" : last ? "last" : "middle";
    return {
      node: wrap(<Table cols={cols} rows={run} part={part} />, i === 0, last),
      units: run.reduce((n, r) => n + units(r), i === 0 ? leadUnits + 1 : 0),
    };
  });
}

/** Un documento por bloques: `build(big)` da sus bloques (con `big`, las tablas y listas largas en trozos). */
interface PagedDoc {
  title: string;
  build: (big: boolean) => Block[];
  footer: React.ReactNode;
}

/**
 * En un documento largo, el primer elemento de cada bloque lleva su número (data-pz), para saber en qué página empieza.
 * Sin envolver el bloque en otra vista: un nivel más de anidamiento hacía que @react-pdf montara filas unas sobre otras
 * al partir la página. Un bloque que empieza por una tabla pasa el número a su vista (Table lo acepta).
 */
function tagFirst(node: ReactNode, tag: number): ReactNode {
  if (!isValidElement(node)) return node;
  if (node.type === Fragment) {
    const kids = Children.toArray((node as ReactElement<{ children?: ReactNode }>).props.children);
    const i = kids.findIndex(isValidElement);
    if (i >= 0) kids[i] = tagFirst(kids[i], tag) as (typeof kids)[number];
    return <>{kids}</>;
  }
  return cloneElement(node as ReactElement<{ "data-pz"?: number }>, { "data-pz": tag });
}

const tagged = (b: Block, i: number) => <Fragment key={i}>{tagFirst(b.node, i)}</Fragment>;

/**
 * Pinta un documento con una sola raíz de @react-pdf para todo el worker. renderToBuffer crea una raíz nueva en cada
 * llamada y no la suelta nunca, con todo su árbol (medido: ~1,5 MB por cada ventana de unas páginas): con las ventanas
 * que se maquetan para cortar los tramos, un informe de 2.000 tareas pasaba del tope de memoria del worker (256 MB). De
 * uno en uno (la raíz es compartida); al terminar se le deja un documento vacío, para soltar el árbol.
 */
let pdfRoot: ReturnType<typeof pdf> | null = null;
let pdfRendering: Promise<unknown> = Promise.resolve();
function renderDoc(doc: ReactElement): Promise<Buffer> {
  const run = pdfRendering.then(async () => {
    const root = (pdfRoot ??= pdf());
    try {
      root.updateContainer(doc);
      // Si un componente lanza al pintar, React desmonta la raíz y queda el <Document /> vacío del PDF anterior: sin esta
      // comprobación salía un PDF en blanco en vez del error. Todos los documentos llevan al menos un <Page>.
      const pages = (root as unknown as { container?: { document?: { children?: unknown[] } } }).container?.document?.children?.length;
      if (pages === 0) throw new Error("El PDF no tiene páginas: falló al pintar el documento.");
      const stream = await root.toBuffer();
      return await new Promise<Buffer>((resolve, reject) => {
        const chunks: Buffer[] = [];
        stream.on("data", (chunk: Buffer) => chunks.push(chunk));
        stream.on("end", () => resolve(Buffer.concat(chunks)));
        stream.on("error", reject);
      });
    } finally {
      root.updateContainer(<Document />);
    }
  });
  pdfRendering = run.catch(() => {});
  return run;
}

type LayoutData = { children?: { children?: { props?: Record<string, unknown> }[] }[] };

/**
 * Maqueta unos bloques en un solo <Page> (como el documento entero, sin pie) y devuelve, de cada página, los bloques que
 * tiene (uno partido sale en las dos). Lee la maquetación que @react-pdf pasa a `onRender`; sin ella, null.
 */
async function layoutPages(blocks: Block[]): Promise<number[][] | null> {
  let pages: number[][] | null = null;
  const onRender = ({ _INTERNAL__LAYOUT__DATA_: layout }: { _INTERNAL__LAYOUT__DATA_?: LayoutData }) => {
    // Lo que no lleva número (el resto de un bloque de varios elementos) cuenta como -1.
    pages = layout?.children?.map((p) => (p.children ?? []).filter((c) => !c.props?.fixed).map((c) => (typeof c.props?.["data-pz"] === "number" ? (c.props["data-pz"] as number) : -1))) ?? null;
  };
  await renderDoc(
    <Document onRender={onRender as () => void}>
      <Page size="A4" style={s.page}>{blocks.map(tagged)}</Page>
    </Document>,
  );
  return pages;
}

/**
 * Tramos de un documento largo cortados donde el documento entero salta de página: se maqueta una ventana de bloques
 * (PDF_CHUNK_UNITS, unas 5 páginas), se corta donde una página empieza con un bloque nuevo (pickCut) y se sigue desde
 * ahí. Cada tramo sale igual que esas páginas del documento entero. Si no hay dónde cortar, la ventana crece con los
 * bloques que vienen detrás (otros PDF_CHUNK_UNITS): doblarla volvía a maquetar lo mismo cuando la ventana era un solo
 * bloque enorme. Solo si tampoco así hay una página que empiece limpia se corta antes de un bloque partido. Si
 * @react-pdf no da la maquetación, tramos por tamaño estimado.
 */
async function naturalChunks(blocks: Block[]): Promise<Block[][]> {
  const chunks: Block[][] = [];
  /** Bloques desde `from` hasta sumar al menos `units` (como mínimo uno). */
  const extend = (from: number, units: number) => {
    let end = from;
    for (let u = 0; end < blocks.length && (end === from || u < units); end++) u += blocks[end]!.units;
    return end;
  };
  let start = 0;
  let end = extend(0, PDF_CHUNK_UNITS);
  let grown = 0;
  while (start < blocks.length) {
    if (end >= blocks.length) {
      chunks.push(blocks.slice(start));
      break;
    }
    const window = blocks.slice(start, end);
    const pages = await layoutPages(window);
    if (!pages) return [...chunks, ...chunkBlocks(blocks.slice(start))];
    const cut = pickCut(pages, { unclean: grown > 0, keep: (i) => !!window[i]?.keep });
    if (!cut) {
      end = extend(end, PDF_CHUNK_UNITS);
      grown++;
      continue;
    }
    chunks.push(blocks.slice(start, start + cut));
    start += cut;
    end = extend(start, PDF_CHUNK_UNITS);
    grown = 0;
  }
  return chunks;
}

/**
 * Pinta un documento. Uno corto, en un solo <Page> (como siempre). Uno largo, en tramos (un <Page> por tramo, ver
 * pdf-chunks.ts), todos con el mismo estilo y el mismo pie fijo, que numera sobre el total de páginas.
 */
async function pagedPdf(doc: PagedDoc, singlePageUnits: number): Promise<Buffer> {
  const small = doc.build(false);
  const big = totalUnits(small) > singlePageUnits;
  const chunks = big ? await naturalChunks(doc.build(true)) : [small];
  return renderDoc(
    <Document title={doc.title} author="Pizarro" creator="Pizarro" producer="Pizarro">
      {chunks.map((chunk, i) => (
        <Page key={i} size="A4" style={s.page}>
          {big ? chunk.map(tagged) : chunk.map((b, j) => <Fragment key={j}>{b.node}</Fragment>)}
          {doc.footer}
        </Page>
      ))}
    </Document>,
  );
}

const Footer = ({ left }: { left: React.ReactNode }) => (
  <View style={s.footer} fixed>
    <Text>{left}</Text>
    <Text render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`} />
  </View>
);

function Kv({ label, value, locale, color = C.text }: { label: string; value: number; locale: string; color?: string }) {
  return (
    <View style={s.kpi}>
      <Text style={[s.kpiValue, { color }]}>{value.toLocaleString(locale)}</Text>
      <Text style={s.kpiLabel}>{label}</Text>
    </View>
  );
}

const titleCell = (t: ReportTask) => <Text>{t.title}</Text>;
function dueCell(today: string, x: Ctx) {
  return function Due(t: ReportTask) {
    const late = t.daysLeft !== null && t.daysLeft < 0 && !t.done;
    return <Text style={{ color: dueColor(t), fontFamily: late ? "Helvetica-Bold" : "Helvetica" }}>{dueLabel(t, today, x)}</Text>;
  };
}

/** Tabla con los campos opcionales activados (coste, horas, prioridad, cliente, inicio, enlace) y sus totales. */
function fieldsBlocks(r: Report, t: T, locale: string, big: boolean): Block[] {
  const f = r.fields!;
  const has = (k: string) => (f.enabled as string[]).includes(k);
  const totals: string[] = [];
  if (has("cost")) totals.push(t("Coste: {total} · pagado {paid} · pendiente {pending}", { total: formatEuro(f.totals.cost, locale), paid: formatEuro(f.totals.paid, locale), pending: formatEuro(f.totals.pending, locale) }));
  if (has("hours")) totals.push(t("Horas: {est} estimadas · {act} reales", { est: formatHours(f.totals.estimatedHours, locale), act: formatHours(f.totals.actualHours, locale) }));
  // Anchos: el título ocupa lo que dejan las demás columnas.
  const extra: Col<ReportFieldRow>[] = [];
  if (has("priority")) extra.push({ label: t("Prioridad"), width: "10%", render: (x) => (x.priority ? t(PRIORITY_LABEL[x.priority]) : "—") });
  if (has("client")) extra.push({ label: t("Cliente"), width: "15%", render: (x) => x.client ?? "—" });
  if (has("startDate")) extra.push({ label: t("Inicio"), width: "12%", render: (x) => (x.startDate ? formatDay(x.startDate, r.today, locale) : "—") });
  if (has("cost")) extra.push({ label: t("Coste"), width: "14%", render: (x) => (x.cost === null ? "—" : `${formatEuro(x.cost, locale)}${x.costPaid ? ` (${t("pagado")})` : ""}`) });
  if (has("hours")) extra.push({ label: t("Horas (est./real)"), width: "12%", render: (x) => `${formatHours(x.estimatedHours, locale) || "—"} / ${formatHours(x.actualHours, locale) || "—"}` });
  const used = extra.reduce((n, c) => n + parseInt(c.width, 10), 0);
  const titleWidth = Math.max(20, 100 - used);
  const cols: Col<ReportFieldRow>[] = [{ label: t("Tarea"), width: `${titleWidth}%`, render: (x) => x.title }, ...extra];
  const lead = (
    <>
      <Text style={s.h2} minPresenceAhead={70}>{t("Campos opcionales")}</Text>
      {totals.map((line) => <Text key={line} style={[s.small, { marginBottom: 2, fontFamily: "Helvetica-Bold" }]}>{line}</Text>)}
    </>
  );
  // Sin filas, el título y los totales solos (como siempre: Table no pinta nada).
  if (!f.rows.length) return [{ node: lead, units: 3 + totals.length }];
  return tableBlocks(f.rows, cols, (x) => rowUnits(x.title, titleWidth), big, (table, first) => <>{first ? lead : null}{table}</>, 2 + totals.length);
}

/** «… y 120 más · Abrir el tablero» debajo de un listado recortado (informe semanal por email, Report.listLimit). */
function MoreLine({ n, url, t, locale }: { n: number; url: string | null; t: T; locale: string }) {
  return (
    <Text style={[s.small, { marginTop: 2, marginBottom: 4 }]}>
      {t("… y {n} más", { n: n.toLocaleString(locale) })}
      {url ? <> · <Link src={url} style={{ color: C.brand }}>{t("Abrir el tablero")}</Link></> : null}
    </Text>
  );
}

function reportDoc(r: Report, t: T, locale: string): PagedDoc {
  const x: Ctx = { t, locale };
  const more = (n: number): Block[] => (n > 0 ? [{ units: 1, node: <MoreLine n={n} url={r.boardUrl} t={t} locale={locale} /> }] : []);
  const trimmed = r.listLimit !== null && (r.more.planned > 0 || r.more.fields > 0 || r.columns.some((c) => !c.isDone && c.more > 0));
  const generated = formatDay(r.today, undefined, locale);
  const k = r.kpis;
  const num = (n: number) => n.toLocaleString(locale);
  const pendingColumns = r.columns.filter((c) => !c.isDone && c.count > 0);
  const people = r.people.filter((p) => p.open > 0);
  const attention = [
    k.unassignedOpen ? t("{n} sin responsable", { n: num(k.unassignedOpen) }) : null,
    k.withoutDueOpen ? t("{n} sin plazo", { n: num(k.withoutDueOpen) }) : null,
  ].filter(Boolean);
  const pendingTypes = r.types.filter((t) => t.open > 0).map((t) => `${t.label} ${num(t.open)}`).join(" · ");
  const planned = [...r.overdue, ...r.upcoming];
  const h2 = (text: string) => <Text style={s.h2} minPresenceAhead={70}>{text}</Text>;
  /** Una sección «título + tabla»; si la tabla se trocea, el título va solo con el primer trozo. */
  const section = <R,>(title: string, rows: R[], cols: Col<R>[], units: (row: R) => number, big: boolean): Block[] =>
    rows.length ? tableBlocks(rows, cols, units, big, (table, first) => <>{first ? h2(title) : null}{table}</>, 3) : [];

  const build = (big: boolean): Block[] => [
    {
      units: 22 + (r.omittedTasks || trimmed ? 2 : 0) + (r.project.description ? textUnits(r.project.description, 110) : 0),
      node: (
        <>
          <View style={s.header}>
            <Text style={s.eyebrow}>{t("Informe de estado del proyecto")}</Text>
            <Text style={s.title}>{r.project.name}</Text>
            <Text style={s.meta}>{r.time ? t("Generado el {date} a las {time} por {name}", { date: generated, time: r.time, name: r.generatedBy }) : t("Generado el {date} por {name}", { date: generated, name: r.generatedBy })}</Text>
            {r.project.description ? <Text style={s.desc}>{r.project.description}</Text> : null}
          </View>

          {/* Resumen */}
          <View style={{ marginBottom: 8 }} wrap={false}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 3 }}>
              <Text style={{ fontFamily: "Helvetica-Bold" }}>{t("Avance: {pct}%", { pct: k.progressPct })}</Text>
              <Text style={s.small}>{t("{done} de {total} tarjetas terminadas", { done: num(k.done), total: num(k.total) })}</Text>
            </View>
            <Bar value={k.progressPct} color={C.green} />
            <View style={[s.kpis, { marginTop: 8 }]}>
              <Kv label={t("Pendientes")} value={k.open} locale={locale} />
              <Kv label={t("Vencidas")} value={k.overdue} locale={locale} color={k.overdue ? C.red : C.text} />
              <Kv label={t("Vencen en 7 días")} value={k.dueSoon} locale={locale} color={k.dueSoon ? C.amber : C.text} />
              <Kv label={t("Terminadas")} value={k.done} locale={locale} color={C.green} />
            </View>
            {pendingTypes ? <Text style={[s.small, { marginTop: 6 }]}>{t("Por tipo: {types}", { types: pendingTypes })}</Text> : null}
            {k.fixed ? <Text style={[s.small, { marginTop: 2 }]}>{t("Tareas fijas: {n} (siempre en la release o el plan; no cuentan en el avance ni en las pendientes)", { n: num(k.fixed) })}</Text> : null}
            {attention.length ? <Text style={[s.small, { marginTop: 2, color: C.amber }]}>{t("Atención: {items}", { items: attention.join(" · ") })}</Text> : null}
            {trimmed ? (
              <Text style={[s.small, { marginTop: 2, color: C.amber }]}>
                {t("Este informe muestra como mucho {n} tareas por listado; el avance y los recuentos incluyen todas.", { n: num(r.listLimit!) })}
                {r.boardUrl ? <> <Link src={r.boardUrl} style={{ color: C.brand }}>{t("Abrir el tablero")}</Link></> : null}
              </Text>
            ) : r.omittedTasks ? <Text style={[s.small, { marginTop: 2, color: C.amber }]}>{t("Se muestran las primeras {n} de {total} tareas en los listados; el avance y los recuentos incluyen todas.", { n: num(k.total + k.fixed - r.omittedTasks), total: num(k.total + k.fixed) })}</Text> : null}
          </View>
        </>
      ),
    },

    // Pendiente por columna
    ...pendingColumns.flatMap((c, ci) => tableBlocks(
      c.tasks,
      [
        { label: t("Tarea"), width: "40%", render: titleCell },
        { label: t("Tipo"), width: "16%", render: (t) => t.kind },
        { label: t("Responsable"), width: "16%", render: (t) => t.assignee ?? "—" },
        { label: t("Plazo"), width: "19%", render: dueCell(r.today, x) },
        { label: t("Subtareas"), width: "9%", render: (t) => t.checklist ?? "—" },
      ],
      (task) => rowUnits(task.title, 40),
      big,
      // Troceada (documento largo): el título y el margen van con el primer y el último trozo; los de en medio, solos.
      (table, first, last) => (first || last ? (
        <>
          {ci === 0 && first ? h2(t("Pendiente")) : null}
          <View style={{ marginBottom: last ? 6 : 0 }}>
            {first ? <Text style={s.h3} minPresenceAhead={60}>{c.name} · {num(c.count)}</Text> : null}
            {table}
            {last && c.more ? <MoreLine n={c.more} url={r.boardUrl} t={t} locale={locale} /> : null}
          </View>
        </>
      ) : table),
      (ci === 0 ? 5 : 2) + (c.more ? 1 : 0),
    )),

    // Plazos: solo si hay vencidos o próximos
    ...section(t("Plazos: vencidos y próximos {n} días", { n: UPCOMING_DAYS }), planned, [
      { label: t("Tarea"), width: "36%", render: titleCell },
      { label: t("Columna"), width: "18%", render: (t) => t.column },
      { label: t("Responsable"), width: "17%", render: (t) => t.assignee ?? "—" },
      { label: t("Plazo"), width: "29%", render: dueCell(r.today, x) },
    ], (task) => rowUnits(task.title, 36), big),
    ...more(r.more.planned),

    // Entregables
    ...section(t("Entregables"), r.deliverables, [
      { label: t("Entregable"), width: "34%", render: (d) => <View><Text style={{ fontFamily: "Helvetica-Bold" }}>{d.name}</Text>{d.description ? <Text style={s.small}>{d.description}</Text> : null}</View> },
      { label: t("Fecha objetivo"), width: "20%", render: (d) => dueLabel({ dueDate: d.dueDate, daysLeft: d.daysLeft, done: d.status === "Completado" }, r.today, x) },
      { label: t("Avance"), width: "24%", render: (d) => <View><Text style={s.small}>{num(d.done)}/{num(d.total)} · {d.pct}%</Text><Bar value={d.pct} color={STATUS_COLOR[d.status]} /></View> },
      { label: t("Estado"), width: "22%", render: (d) => <View style={{ flexDirection: "row" }}><Text style={[s.pill, { backgroundColor: STATUS_COLOR[d.status] }]}>{t(d.status)}</Text></View> },
    ], (d) => 1.5 + rowUnits(d.name, 34) + (d.description ? textUnits(d.description, 40) : 0), big),

    // Carga por persona
    ...section(t("Carga por persona"), people, [
      { label: t("Responsable"), width: "60%", render: (p) => p.name },
      { label: t("Pendientes"), width: "20%", render: (p) => num(p.open) },
      { label: t("Vencidas"), width: "20%", render: (p) => <Text style={p.overdue ? { color: C.red, fontFamily: "Helvetica-Bold" } : undefined}>{num(p.overdue)}</Text> },
    ], (p) => rowUnits(p.name, 60), big),

    // Terminadas recientemente
    ...section(t("Terminadas en los últimos {n} días", { n: RECENT_DONE_DAYS }), r.recentDone, [
      { label: t("Tarea"), width: "58%", render: titleCell },
      { label: t("Tipo"), width: "20%", render: (t) => t.kind },
      { label: t("Columna"), width: "22%", render: (t) => t.column },
    ], (task) => rowUnits(task.title, 58), big),

    // Campos opcionales del proyecto
    ...(r.fields ? [...fieldsBlocks(r, t, locale, big), ...more(r.more.fields)] : []),

    // Releases
    ...section(t("Últimas releases"), r.releases, [
      { label: t("Nº"), width: "9%", render: (x) => `R${x.number}` },
      { label: t("Título"), width: "56%", render: (x) => x.title },
      { label: t("Fecha"), width: "21%", render: (x) => formatDay(x.deployedAt.slice(0, 10), r.today, locale) },
      { label: t("Tareas"), width: "14%", render: (x) => num(x.taskCount) },
    ], (rel) => rowUnits(rel.title, 56), big),
  ];

  return { title: `${t("Informe")} · ${r.project.name}`, build, footer: <Footer left={<>{r.project.name} · {t("Informe del {date}", { date: generated })}</>} /> };
}

interface WeekPlanPdfInput {
  project: string;
  column: string;
  today: string;
  /** Lunes y domingo (YYYY-MM-DD) de la semana que se planifica, los de las secciones por día. */
  weekStart: string;
  weekEnd: string;
  generatedBy: string;
  groupBy: WeekPlanGroupBy;
  sections: WeekPlanSection[];
}

function weekPlanDoc(r: WeekPlanPdfInput, t: T, locale: string): PagedDoc {
  const byDay = r.groupBy === "day";
  const total = r.sections.reduce((n, sec) => n + sec.tasks.length, 0);
  const titleWidth = byDay ? 52 : 50;
  const cols: Col<WeekPlanTask>[] = [
    { label: t("Tarea"), width: `${titleWidth}%`, render: (x) => x.title },
    { label: t("Tipo"), width: "18%", render: (x) => x.kind },
    byDay
      ? { label: t("Responsable"), width: "30%", render: (x) => x.assigneeName ?? "—" }
      : { label: t("Fecha"), width: "32%", render: (x) => (x.dueDate ? formatDay(x.dueDate, r.today, locale) : "—") },
  ];
  const build = (big: boolean): Block[] => [
    {
      units: 8,
      node: (
        <>
          <View style={s.header}>
            <Text style={s.eyebrow}>{t("Planificación semanal")}</Text>
            <Text style={s.title}>{r.column}</Text>
            <Text style={s.meta}>
              {r.project} · {t("Semana del {from} al {to}", weekRangeEnds(r.weekStart, r.weekEnd, locale))} · {byDay ? t("Por día") : t("Por persona")} · {total === 1 ? t("1 tarea") : t("{n} tareas", { n: total.toLocaleString(locale) })}
            </Text>
          </View>
          {r.sections.length === 0 && <Text style={s.small}>{t("No hay tareas en esta columna.")}</Text>}
        </>
      ),
    },
    ...r.sections.flatMap((sec) => tableBlocks(sec.tasks, cols, (x) => rowUnits(x.title, titleWidth), big, (table, first) => (first ? (
      <View>
        <Text style={s.h3} minPresenceAhead={50}>{sec.label} <Text style={s.small}>({sec.tasks.length.toLocaleString(locale)})</Text></Text>
        {table}
      </View>
    ) : table), 2)),
  ];
  return { title: `${t("Planificación semanal")} · ${r.project}`, build, footer: <Footer left={<>{r.project} · {r.column}</>} /> };
}

interface ChecklistPdfInput {
  project: string;
  column: string;
  today: string;
  by: ChecklistGroupBy;
  groups: ChecklistGroup[];
}

function checklistDoc(r: ChecklistPdfInput, t: T, locale: string): PagedDoc {
  const total = r.groups.reduce((n, g) => n + g.items.length, 0);
  const done = r.groups.reduce((n, g) => n + g.items.filter((i) => i.done).length, 0);
  type Item = ChecklistGroup["items"][number];
  const itemUnits = (it: Item) => 0.2 + textUnits(r.by === "kind" ? `${it.title}  (${it.taskTitle})` : it.title, 105);
  const item = (it: Item) => (
    <View key={it.id} style={{ flexDirection: "row", marginBottom: 2 }} wrap={false}>
      <Text style={{ width: 16, fontFamily: "Helvetica-Bold", color: it.done ? C.green : C.muted }}>{it.done ? "[x]" : "[ ]"}</Text>
      <Text style={{ flex: 1, color: it.done ? C.muted : C.text }}>
        {it.title}
        {r.by === "kind" ? <Text style={s.small}>  ({it.taskTitle})</Text> : null}
      </Text>
    </View>
  );
  // En un documento largo, el título del grupo con sus primeras subtareas y luego cada subtarea en su bloque (ver rowRuns).
  const groupBlocks = (g: ChecklistGroup, big: boolean): Block[] =>
    rowRuns(g.items, big).map((run, i) => ({
      units: run.reduce((n, it) => n + itemUnits(it), i === 0 ? 2 : 0),
      node: i === 0 ? (
        <View>
          <Text style={s.h3} minPresenceAhead={40}>{g.label} <Text style={s.small}>({g.items.filter((i) => i.done).length.toLocaleString(locale)}/{g.items.length.toLocaleString(locale)})</Text></Text>
          {run.map(item)}
        </View>
      ) : item(run[0]!),
    }));
  const build = (big: boolean): Block[] => [
    {
      units: 8,
      node: (
        <>
          <View style={s.header}>
            <Text style={s.eyebrow}>{t("Lista consolidada")}</Text>
            <Text style={s.title}>{r.column}</Text>
            <Text style={s.meta}>
              {r.project} · {formatDay(r.today, undefined, locale)} · {r.by === "card" ? t("Por tarjeta") : t("Por tipo de tarea")} · {t("{done} de {total} hechas", { done: done.toLocaleString(locale), total: total.toLocaleString(locale) })}
            </Text>
          </View>
          {r.groups.length === 0 && <Text style={s.small}>{t("No hay subtareas en esta columna.")}</Text>}
        </>
      ),
    },
    ...r.groups.flatMap((g) => groupBlocks(g, big)),
  ];
  return { title: `${t("Lista consolidada")} · ${r.project}`, build, footer: <Footer left={<>{r.project} · {r.column}</>} /> };
}

/** Tarea tal como se entrega al cliente: sin comentarios, notas internas ni datos de personas. */
interface DeliveryTask {
  title: string;
  kind: string;
  dueDate: string | null;
  subtaskTotal: number;
  doneSubtasks: string[];
}

interface DeliveryPdfInput {
  project: string;
  column: string;
  today: string;
  tasks: DeliveryTask[];
}

/** Tamaño de una tarjeta del resumen para el cliente: título, línea de datos y una línea (o más) por subtarea hecha. */
const deliveryUnits = (x: DeliveryTask) => 2 + textUnits(x.title, 85) + x.doneSubtasks.reduce((n, title) => n + textUnits(`- ${title}`, 110), 0);

/**
 * Hasta este tamaño la tarjeta no se parte (si no cabe al final de una página, pasa entera a la siguiente). Una más
 * larga podría no caber en una página: @react-pdf la aplastaba sobre la primera (texto encima de texto). Esa se parte
 * entre subtareas; el título y la línea de datos van juntos y con algunas subtareas detrás.
 */
const DELIVERY_UNBROKEN_UNITS = 40;

function deliveryDoc(r: DeliveryPdfInput, t: T, locale: string): PagedDoc {
  const card = (x: DeliveryTask, units: number) => {
    const unbroken = units <= DELIVERY_UNBROKEN_UNITS;
    const head = (
      <>
        <Text style={{ fontFamily: "Helvetica-Bold", fontSize: 10.5 }}>{x.title}</Text>
        <Text style={s.small}>
          {x.kind}
          {x.dueDate ? ` · ${t("Fecha")}: ${formatDay(x.dueDate, r.today, locale)}` : ""}
          {x.subtaskTotal > 0 ? ` · ${t("{done} de {total} subtareas hechas", { done: x.doneSubtasks.length, total: x.subtaskTotal })}` : ""}
        </Text>
      </>
    );
    return (
      <View style={{ borderBottomWidth: 1, borderBottomColor: C.line, paddingVertical: 6 }} wrap={!unbroken}>
        {unbroken ? head : <View wrap={false} minPresenceAhead={36}>{head}</View>}
        {x.doneSubtasks.map((title, j) => (
          <Text key={j} style={{ marginLeft: 8, marginTop: 1 }}>- {title}</Text>
        ))}
      </View>
    );
  };
  const build = (): Block[] => [
    {
      units: 8,
      node: (
        <>
          <View style={s.header}>
            <Text style={s.eyebrow}>{t("Resumen para el cliente")}</Text>
            <Text style={s.title}>{r.project}</Text>
            <Text style={s.meta}>{r.column} · {formatDay(r.today, undefined, locale)} · {r.tasks.length === 1 ? t("1 tarea") : t("{n} tareas", { n: r.tasks.length.toLocaleString(locale) })}</Text>
          </View>
          {r.tasks.length === 0 && <Text style={s.small}>{t("No hay tareas en esta columna.")}</Text>}
        </>
      ),
    },
    ...r.tasks.map((x) => {
      const units = deliveryUnits(x);
      return { units, node: card(x, units) };
    }),
  ];
  return { title: `${t("Resumen para el cliente")} · ${r.project}`, build, footer: <Footer left={r.project} /> };
}

// --- Plan de una columna «Asignación a persona» --------------------------------------------------------------------------

/** Tamaño de una tarea del plan: título, línea de datos, primera línea de la descripción y subtareas pendientes. */
const planTaskUnits = (x: AssignPlanTask) =>
  2 + textUnits(x.title, 85) + (x.firstLine ? textUnits(x.firstLine, 110) : 0)
  + x.pendingSubtasks.slice(0, PLAN_SUBTASKS_SHOWN).reduce((n, title) => n + textUnits(`[ ] ${title}`, 105), 0)
  + (x.pendingCount > PLAN_SUBTASKS_SHOWN ? 1 : 0);

function assignPlanDoc(r: AssignPlanPdfInput, t: T, locale: string): PagedDoc {
  const total = r.groups.reduce((n, g) => n + g.tasks.length, 0);
  const card = (x: AssignPlanTask, overdue: boolean, units: number) => {
    const unbroken = units <= DELIVERY_UNBROKEN_UNITS;
    const meta = [x.kind, x.priority ? `${t("Prioridad")}: ${t(PRIORITY_LABEL[x.priority as keyof typeof PRIORITY_LABEL] ?? x.priority)}` : null].filter(Boolean).join(" · ");
    const head = (
      <>
        <Text style={{ fontFamily: "Helvetica-Bold", fontSize: 10.5 }}>{x.title}</Text>
        <Text style={s.small}>
          {meta}
          {x.dueDate ? <Text style={overdue ? { color: C.red, fontFamily: "Helvetica-Bold" } : undefined}>{`${meta ? " · " : ""}${t("Vence el {date}", { date: formatDay(x.dueDate, r.today, locale) })}`}</Text> : null}
        </Text>
        {x.firstLine ? <Text style={{ color: C.muted, marginTop: 2 }}>{x.firstLine}</Text> : null}
      </>
    );
    const more = x.pendingCount - PLAN_SUBTASKS_SHOWN;
    return (
      <View style={{ borderBottomWidth: 1, borderBottomColor: C.line, paddingVertical: 6 }} wrap={!unbroken}>
        {unbroken ? head : <View wrap={false} minPresenceAhead={36}>{head}</View>}
        {x.pendingSubtasks.slice(0, PLAN_SUBTASKS_SHOWN).map((title, j) => (
          <View key={j} style={{ flexDirection: "row", marginLeft: 8, marginTop: 1 }} wrap={false}>
            <Text style={{ width: 16, color: C.muted }}>[ ]</Text>
            <Text style={{ flex: 1 }}>{title}</Text>
          </View>
        ))}
        {more > 0 ? <Text style={{ ...s.small, marginLeft: 8, marginTop: 1 }}>{more === 1 ? t("y 1 subtarea más") : t("y {n} subtareas más", { n: more.toLocaleString(locale) })}</Text> : null}
      </View>
    );
  };
  const build = (): Block[] => [
    {
      units: 8,
      node: (
        <>
          <View style={s.header}>
            <Text style={s.eyebrow}>{t("Plan de tareas")}</Text>
            <Text style={s.title}>{t("Plan de {name}", { name: r.person })}</Text>
            <Text style={s.meta}>
              {r.column} · {r.project} · {formatDay(r.today, undefined, locale)} · {total === 1 ? t("1 tarea") : t("{n} tareas", { n: total.toLocaleString(locale) })}
            </Text>
            {r.others > 0 ? <Text style={s.meta}>{r.others === 1 ? t("1 tarjeta de la columna es de otra persona y no sale en el plan.") : t("{n} tarjetas de la columna son de otras personas y no salen en el plan.", { n: r.others.toLocaleString(locale) })}</Text> : null}
          </View>
          {total === 0 && <Text style={s.small}>{t("No hay tareas de esta persona en la columna.")}</Text>}
        </>
      ),
    },
    ...r.groups.flatMap((g): Block[] => [
      {
        units: 2,
        keep: true,
        node: (
          <Text style={{ ...s.h3, ...(g.bucket === "overdue" ? { color: C.red } : {}) }} minPresenceAhead={50}>
            {t(ASSIGN_PLAN_LABEL[g.bucket])} <Text style={s.small}>({g.tasks.length.toLocaleString(locale)})</Text>
          </Text>
        ),
      },
      ...g.tasks.map((x) => {
        const units = planTaskUnits(x);
        return { units, node: card(x, g.bucket === "overdue", units) };
      }),
    ]),
  ];
  return {
    title: `${t("Plan de {name}", { name: r.person })} · ${r.column} · ${r.project}`,
    build,
    footer: <Footer left={<>{t("Plan de {name}", { name: r.person })} · {r.column} · {r.project}</>} />,
  };
}

// --- Markdown de las descripciones (bloques de pdf-markdown.ts) ---------------------------------------------------------

function runFont(r: PdfRun): string {
  if (r.code) return r.b ? "Courier-Bold" : "Courier";
  if (r.b && r.i) return "Helvetica-BoldOblique";
  if (r.b) return "Helvetica-Bold";
  if (r.i) return "Helvetica-Oblique";
  return "Helvetica";
}

function Runs({ runs }: { runs: PdfRun[] }) {
  return (
    <>
      {runs.map((r, i) => {
        const deco = [r.u || r.href ? "underline" : "", r.s ? "line-through" : ""].filter(Boolean).join(" ") || undefined;
        const style = { fontFamily: runFont(r), textDecoration: deco as "underline" | undefined, color: r.href ? C.brand : r.code ? "#be185d" : undefined };
        return r.href ? <Link key={i} src={r.href} style={style}>{r.text}</Link> : <Text key={i} style={style}>{r.text}</Text>;
      })}
    </>
  );
}

const HEADING_SIZE = [11.5, 10.5, 10, 9.5, 9, 9];

const CODE_STYLE = { marginTop: 3, padding: 5, fontFamily: "Courier", fontSize: 8, backgroundColor: C.soft, borderWidth: 1, borderColor: C.line, borderRadius: 3 };
/** Una línea de un bloque de código partido por líneas: la caja se reparte entre la primera, las de en medio y la última. */
const CODE_LINE = { fontFamily: "Courier", fontSize: 8, backgroundColor: C.soft, borderColor: C.line, paddingLeft: 5, paddingRight: 5, borderLeftWidth: 1, borderRightWidth: 1 };
const CODE_LINE_STYLE = {
  first: { ...CODE_LINE, marginTop: 3, paddingTop: 5, borderTopWidth: 1, borderTopLeftRadius: 3, borderTopRightRadius: 3 },
  middle: CODE_LINE,
  last: { ...CODE_LINE, paddingBottom: 5, borderBottomWidth: 1, borderBottomLeftRadius: 3, borderBottomRightRadius: 3 },
};

type ListBlock = Extract<PdfBlock, { t: "list" }>;
/** Estilo de la fila de un trozo: márgenes y, en el último de una sesión, el borde de abajo (ver sessionParts). */
type PartStyle = { marginTop?: number; paddingLeft?: number; paddingBottom?: number; borderBottomWidth?: number; borderBottomColor?: string };

/** Elemento `j` de una lista: su viñeta (o número, o casilla) y su contenido, con `style` en la fila. */
function listItem(b: ListBlock, j: number, style: PartStyle, extra?: { minPresenceAhead?: number }) {
  const item = b.items[j]!;
  return (
    <View key={j} style={{ flexDirection: "row", ...style }} minPresenceAhead={extra?.minPresenceAhead}>
      <Text style={{ width: b.ordered || item.checked !== null ? 18 : 10, color: item.checked ? C.green : C.muted, fontFamily: item.checked !== null ? "Helvetica-Bold" : "Helvetica" }}>
        {item.checked !== null ? (item.checked ? "[x]" : "[ ]") : b.ordered ? `${b.start + j}.` : "•"}
      </Text>
      <View style={{ flex: 1 }}><MarkdownBlocks blocks={item.blocks} tight /></View>
    </View>
  );
}

/** Bloques de Markdown. `tight`: dentro de un elemento de lista, el primero sin margen superior (va junto a su viñeta). */
function MarkdownBlocks({ blocks, tight = false }: { blocks: PdfBlock[]; tight?: boolean }) {
  return (
    <>
      {blocks.map((b, i) => {
        const top = tight && i === 0 ? 0 : 3;
        switch (b.t) {
          case "p": return <Text key={i} style={{ marginTop: top }}><Runs runs={b.runs} /></Text>;
          case "h": return <Text key={i} style={{ marginTop: 6, fontSize: HEADING_SIZE[b.level - 1], fontFamily: "Helvetica-Bold", color: "#312e81" }} minPresenceAhead={20}><Runs runs={b.runs} /></Text>;
          case "code": return <Text key={i} style={CODE_STYLE}>{b.text}</Text>;
          case "hr": return <View key={i} style={{ marginVertical: 5, borderBottomWidth: 1, borderBottomColor: C.line }} />;
          case "quote": return <View key={i} style={{ marginTop: 3, paddingLeft: 7, borderLeftWidth: 2, borderLeftColor: C.line, color: C.muted }}><MarkdownBlocks blocks={b.blocks} /></View>;
          case "list": return (
            <View key={i} style={{ marginTop: top }}>
              {b.items.map((item, j) => listItem(b, j, { marginTop: j === 0 ? 0 : 2 }))}
            </View>
          );
          case "table": return (
            <View key={i} style={{ ...s.table, marginTop: 4 }}>
              {[b.header, ...b.rows].map((row, j, all) => (
                <View key={j} style={j === all.length - 1 ? s.trLast : s.tr} wrap={false}>
                  {row.map((cell, k) => (
                    <Text key={k} style={[s.td, { flex: 1 }, j === 0 ? s.th : {}]}><Runs runs={cell} /></Text>
                  ))}
                </View>
              ))}
            </View>
          );
          default: return null;
        }
      })}
    </>
  );
}

/**
 * Un trozo de la descripción de una sesión (ver sessionParts): su tamaño, si pide ir con lo siguiente y cómo se pinta
 * con el estilo del trozo (`style`: el hueco del número a la izquierda y, en el último, el borde de abajo).
 */
interface MarkdownPart {
  units: number;
  keep?: boolean;
  render: (style: PartStyle) => React.ReactNode;
}

/** Envuelve un bloque en una vista con el estilo del trozo (lo que no puede llevarlo en sí mismo). */
function wrapped(node: React.ReactNode, keep?: boolean): MarkdownPart["render"] {
  return function wrap(style) {
    return <View style={style} minPresenceAhead={keep ? 20 : undefined}>{node}</View>;
  };
}

/**
 * Un bloque de Markdown en trozos que, uno debajo de otro, se ven igual que el bloque entero: una lista, elemento a
 * elemento (cada fila lleva el margen que tenía en la lista y el estilo del trozo, sin vistas de más: con miles de
 * elementos, cada vista cuenta en la memoria del worker); un bloque de código, línea a línea (la caja repartida entre
 * ellas). Así ninguna lista ni ningún código largo es un trozo de varias páginas, que habría que maquetar entero una y
 * otra vez para encontrar dónde cortar (ver naturalChunks). Lo demás, en un trozo.
 */
function markdownParts(b: PdfBlock): MarkdownPart[] {
  if (b.t === "list" && b.items.length > 1) {
    return b.items.map((item, j) => ({
      units: 0.2 + markdownUnits(item.blocks),
      render: (style) => listItem(b, j, { marginTop: j === 0 ? 3 : 2, ...style }),
    }));
  }
  if (b.t === "code" && b.text.includes("\n")) {
    const lines = b.text.split("\n");
    return lines.map((line, j) => ({
      units: (j === 0 ? 1.5 : 0) + textUnits(line, 110),
      // wrap={false}: si el salto de página caía tras el hueco de arriba de la primera línea, esta se partía y pasaba a la
      // página siguiente encima de la segunda.
      render: wrapped(<Text wrap={false} style={CODE_LINE_STYLE[j === 0 ? "first" : j === lines.length - 1 ? "last" : "middle"]}>{line || " "}</Text>),
    }));
  }
  return [{ units: markdownUnits([b]), keep: b.t === "h", render: wrapped(<MarkdownBlocks blocks={[b]} />, b.t === "h") }];
}

// --- Programa del curso (columna PROGRAM) -------------------------------------------------------------------------------

/** Tamaño de unos bloques de Markdown: líneas de texto (unos 95 caracteres por línea) más un poco por bloque. */
function markdownUnits(blocks: PdfBlock[]): number {
  const runsText = (runs: PdfRun[]) => runs.map((r) => r.text).join("");
  return blocks.reduce((n, b) => {
    switch (b.t) {
      case "p": case "h": return n + 0.5 + textUnits(runsText(b.runs), 95);
      case "code": return n + 1.5 + textUnits(b.text, 110);
      case "hr": return n + 1;
      case "quote": return n + 0.5 + markdownUnits(b.blocks);
      case "list": return n + b.items.reduce((m, item) => m + 0.2 + markdownUnits(item.blocks), 0);
      case "table": return n + 1 + [b.header, ...b.rows].reduce((m, row) => m + 0.4 + Math.max(1, ...row.map((cell) => textUnits(runsText(cell), Math.max(10, Math.floor(95 / Math.max(1, row.length)))))), 0);
      default: return n;
    }
  }, 0);
}

type ProgramSessionPdf = ProgramPdfDocument["sessions"][number];

const SESSION_ROW = { flexDirection: "row", gap: 10 } as const;
const SESSION_END = { paddingBottom: 8, borderBottomWidth: 1, borderBottomColor: C.line };

function programDoc(r: ProgramPdfDocument, t: T, locale: string): PagedDoc {
  const count = r.sessions.length === 1 ? t("1 sesión") : t("{n} sesiones", { n: r.sessions.length.toLocaleString(locale) });
  const circle = (x: ProgramSessionPdf) => (
    <View style={{ width: 26, height: 26, borderRadius: 13, backgroundColor: C.brandSoft, alignItems: "center", justifyContent: "center" }}>
      <Text style={{ fontFamily: "Helvetica-Bold", fontSize: 10.5, color: C.brand }}>{x.n}</Text>
    </View>
  );
  const head = (x: ProgramSessionPdf) => (
    <View wrap={false} minPresenceAhead={30}>
      <Text style={{ fontFamily: "Helvetica-Bold", fontSize: 11.5, lineHeight: 1.25 }}>{t("Sesión {n}", { n: x.n })}: {x.title}</Text>
      <Text style={{ fontSize: 8.5, color: x.date ? C.brand : C.muted, marginTop: 2, fontFamily: "Helvetica-Bold" }}>{x.date ?? t("Fecha por determinar")}</Text>
      {r.withAssignee && x.assignee ? <Text style={{ ...s.small, marginTop: 1 }}>{t("Responsable")}: {x.assignee}</Text> : null}
    </View>
  );
  /**
   * La sesión en trozos que, uno debajo de otro, se ven igual que la sesión entera: el número y la cabecera en el
   * primero (sin partir: antes el número podía quedarse solo al pie y el título pasar a la página siguiente); luego la
   * descripción en trozos (markdownParts), con un hueco del ancho del número; el borde de abajo en el último. Así las
   * páginas suelen empezar con un trozo entero (ver pickCut), y lo que pedía seguir con algo detrás (la cabecera, los
   * títulos) lo pide el propio trozo.
   */
  const sessionParts = (x: ProgramSessionPdf): Block[] => {
    const md = x.blocks.flatMap(markdownParts);
    const only = md.length === 0;
    const parts: Block[] = [{
      units: 4 + textUnits(x.title, 70),
      keep: !only,
      node: (
        <View style={{ ...SESSION_ROW, paddingTop: 8, ...(only ? SESSION_END : {}) }} wrap={false} minPresenceAhead={only ? undefined : 30}>
          {circle(x)}
          <View style={{ flex: 1 }}>{head(x)}</View>
        </View>
      ),
    }];
    md.forEach((part, i) => {
      const last = i === md.length - 1;
      // El hueco del número (26) y su separación (10) como margen izquierdo del trozo.
      parts.push({ units: part.units, keep: part.keep, node: part.render({ paddingLeft: 36, ...(last ? SESSION_END : {}) }) });
    });
    return parts;
  };
  const build = (): Block[] => [
    {
      units: 8,
      node: (
        <>
          <View style={s.header}>
            <Text style={s.eyebrow}>{t("Programa del curso")}</Text>
            <Text style={s.title}>{r.project}</Text>
            <Text style={s.meta}>{count} · {t("Publicado el {date}", { date: formatDay(r.today, undefined, locale) })}</Text>
          </View>
          {r.sessions.length === 0 && <Text style={s.small}>{t("Aún no hay sesiones en esta columna.")}</Text>}
        </>
      ),
    },
    ...r.sessions.flatMap(sessionParts),
  ];
  return { title: `${t("Programa")} · ${r.project}`, build, footer: <Footer left={r.project} /> };
}

/**
 * Trabajo para el worker de PDF: datos ya preparados (serializables) y el idioma de quien lo pide. `singlePageUnits`:
 * solo para las pruebas, el tamaño hasta el que el documento va en un solo <Page> (PDF_SINGLE_PAGE_UNITS).
 */
export type PdfJob = (
  | { kind: "report"; locale: Locale; input: Report }
  | { kind: "weekPlan"; locale: Locale; input: WeekPlanPdfInput }
  | { kind: "checklist"; locale: Locale; input: ChecklistPdfInput }
  | { kind: "delivery"; locale: Locale; input: DeliveryPdfInput }
  | { kind: "program"; locale: Locale; input: ProgramPdfInput }
  | { kind: "assignPlan"; locale: Locale; input: AssignPlanPdfInput }
) & { singlePageUnits?: number };

/** El documento de un trabajo. Los textos de los datos se adaptan antes a la fuente (ver pdf-text.ts). */
function jobDoc(raw: PdfJob): PagedDoc {
  const t = makeT(raw.locale);
  const locale = intlLocale(raw.locale);
  switch (raw.kind) {
    // El programa llega con el Markdown de cada sesión: aquí (en el worker) se convierte en bloques, antes de adaptar los textos.
    case "program": return programDoc(pdfSafeData(programBlocks(raw.input)), t, locale);
    case "report": return reportDoc(pdfSafeData(raw.input), t, locale);
    case "weekPlan": return weekPlanDoc(pdfSafeData(raw.input), t, locale);
    case "checklist": return checklistDoc(pdfSafeData(raw.input), t, locale);
    case "delivery": return deliveryDoc(pdfSafeData(raw.input), t, locale);
    case "assignPlan": return assignPlanDoc(pdfSafeData(raw.input), t, locale);
    default: throw new Error(`Tipo de PDF desconocido: ${(raw as { kind: unknown }).kind}`);
  }
}

/** Pinta el PDF de un trabajo (en el worker). */
export async function renderPdfJob(raw: PdfJob): Promise<Buffer> {
  return pagedPdf(jobDoc(raw), raw.singlePageUnits ?? PDF_SINGLE_PAGE_UNITS);
}
