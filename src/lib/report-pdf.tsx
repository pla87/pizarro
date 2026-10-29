import "server-only";
import { Document, Font, Page, StyleSheet, Text, View, renderToBuffer } from "@react-pdf/renderer";
import { makeT, type T } from "@/i18n/core";
import { formatDay } from "./dates";
import type { ChecklistGroup, ChecklistGroupBy } from "./checklist";
import type { WeekPlanGroupBy, WeekPlanSection, WeekPlanTask } from "./week-plan";
import { RECENT_DONE_DAYS, UPCOMING_DAYS, type DeliverableStatus, type Report, type ReportTask } from "./report";

// Sin partición de palabras con guion: en español quedaba «re-sumen».
Font.registerHyphenationCallback((word) => [word]);

const C = {
  text: "#0f172a",
  muted: "#64748b",
  faint: "#94a3b8",
  line: "#e2e8f0",
  soft: "#f8fafc",
  brand: "#4f46e5",
  brandSoft: "#eef2ff",
  green: "#059669",
  amber: "#d97706",
  red: "#dc2626",
};

const STATUS_COLOR: Record<DeliverableStatus, string> = {
  Completado: C.green,
  "En plazo": C.brand,
  "En riesgo": C.amber,
  Retrasado: C.red,
  "Sin fecha": C.muted,
  "Sin tareas": C.faint,
};

const s = StyleSheet.create({
  page: { paddingTop: 36, paddingBottom: 48, paddingHorizontal: 36, fontFamily: "Helvetica", fontSize: 9, color: C.text, lineHeight: 1.35 },
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
  footer: { position: "absolute", bottom: 20, left: 36, right: 36, flexDirection: "row", justifyContent: "space-between", fontSize: 7.5, color: C.faint },
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
  if (t.daysLeft < 0) return `${date} ${x.t("(hace {n} d)", { n: -t.daysLeft })}`;
  if (t.daysLeft === 0) return `${date} ${x.t("(hoy)")}`;
  return `${date} ${x.t("(en {n} d)", { n: t.daysLeft })}`;
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

/** Tabla sin cabecera suelta: la cabecera viaja junto a las primeras filas y ninguna fila se parte. */
function Table<T>({ cols, rows }: { cols: Col<T>[]; rows: T[] }) {
  if (!rows.length) return null;
  const header = (
    <View style={[s.tr, s.th]}>
      {cols.map((c) => (
        <Text key={c.label} style={[s.td, { width: c.width }]}>{c.label}</Text>
      ))}
    </View>
  );
  const row = (r: T, i: number) => (
    <View key={i} style={i === rows.length - 1 ? s.trLast : s.tr} wrap={false}>
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
  const HEAD_ROWS = 2;
  return (
    <View style={s.table}>
      <View wrap={false}>
        {header}
        {rows.slice(0, HEAD_ROWS).map((r, i) => row(r, i))}
      </View>
      {rows.slice(HEAD_ROWS).map((r, i) => row(r, i + HEAD_ROWS))}
    </View>
  );
}

function Kv({ label, value, color = C.text }: { label: string; value: number; color?: string }) {
  return (
    <View style={s.kpi}>
      <Text style={[s.kpiValue, { color }]}>{value}</Text>
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

function ReportDocument({ r, t, locale }: { r: Report; t: T; locale: string }) {
  const x: Ctx = { t, locale };
  const generated = formatDay(r.today, undefined, locale);
  const k = r.kpis;
  const pendingColumns = r.columns.filter((c) => !c.isDone && c.count > 0);
  const people = r.people.filter((p) => p.open > 0);
  const attention = [
    k.unassignedOpen ? t("{n} sin responsable", { n: k.unassignedOpen }) : null,
    k.withoutDueOpen ? t("{n} sin plazo", { n: k.withoutDueOpen }) : null,
  ].filter(Boolean);
  const pendingTypes = r.types.filter((t) => t.open > 0).map((t) => `${t.label} ${t.open}`).join(" · ");
  const planned = [...r.overdue, ...r.upcoming];
  return (
    <Document title={`${t("Informe")} · ${r.project.name}`} author="Pizarro" creator="Pizarro" producer="Pizarro">
      <Page size="A4" style={s.page}>
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
            <Text style={s.small}>{t("{done} de {total} tarjetas terminadas", { done: k.done, total: k.total })}</Text>
          </View>
          <Bar value={k.progressPct} color={C.green} />
          <View style={[s.kpis, { marginTop: 8 }]}>
            <Kv label={t("Pendientes")} value={k.open} />
            <Kv label={t("Vencidas")} value={k.overdue} color={k.overdue ? C.red : C.text} />
            <Kv label={t("Vencen en 7 días")} value={k.dueSoon} color={k.dueSoon ? C.amber : C.text} />
            <Kv label={t("Terminadas")} value={k.done} color={C.green} />
          </View>
          {pendingTypes ? <Text style={[s.small, { marginTop: 6 }]}>{t("Por tipo: {types}", { types: pendingTypes })}</Text> : null}
          {attention.length ? <Text style={[s.small, { marginTop: 2, color: C.amber }]}>{t("Atención: {items}", { items: attention.join(" · ") })}</Text> : null}
        </View>

        {/* Pendiente por columna */}
        {pendingColumns.length ? <Text style={s.h2} minPresenceAhead={70}>{t("Pendiente")}</Text> : null}
        {pendingColumns.map((c) => (
          <View key={c.name} style={{ marginBottom: 6 }}>
            <Text style={s.h3} minPresenceAhead={60}>{c.name} · {c.count}</Text>
            <Table
              rows={c.tasks}
              cols={[
                { label: t("Tarea"), width: "40%", render: titleCell },
                { label: t("Tipo"), width: "16%", render: (t) => t.kind },
                { label: t("Responsable"), width: "16%", render: (t) => t.assignee ?? "—" },
                { label: t("Plazo"), width: "19%", render: dueCell(r.today, x) },
                { label: t("Subtareas"), width: "9%", render: (t) => t.checklist ?? "—" },
              ]}
            />
          </View>
        ))}

        {/* Plazos: solo si hay vencidos o próximos */}
        {planned.length ? (
          <>
            <Text style={s.h2} minPresenceAhead={70}>{t("Plazos: vencidos y próximos {n} días", { n: UPCOMING_DAYS })}</Text>
            <Table
              rows={planned}
              cols={[
                { label: t("Tarea"), width: "36%", render: titleCell },
                { label: t("Columna"), width: "18%", render: (t) => t.column },
                { label: t("Responsable"), width: "17%", render: (t) => t.assignee ?? "—" },
                { label: t("Plazo"), width: "29%", render: dueCell(r.today, x) },
              ]}
            />
          </>
        ) : null}

        {/* Entregables */}
        {r.deliverables.length ? (
          <>
            <Text style={s.h2} minPresenceAhead={70}>{t("Entregables")}</Text>
            <Table
              rows={r.deliverables}
              cols={[
                { label: t("Entregable"), width: "34%", render: (d) => <View><Text style={{ fontFamily: "Helvetica-Bold" }}>{d.name}</Text>{d.description ? <Text style={s.small}>{d.description}</Text> : null}</View> },
                { label: t("Fecha objetivo"), width: "20%", render: (d) => dueLabel({ dueDate: d.dueDate, daysLeft: d.daysLeft, done: d.status === "Completado" }, r.today, x) },
                { label: t("Avance"), width: "24%", render: (d) => <View><Text style={s.small}>{d.done}/{d.total} · {d.pct}%</Text><Bar value={d.pct} color={STATUS_COLOR[d.status]} /></View> },
                { label: t("Estado"), width: "22%", render: (d) => <View style={{ flexDirection: "row" }}><Text style={[s.pill, { backgroundColor: STATUS_COLOR[d.status] }]}>{t(d.status)}</Text></View> },
              ]}
            />
          </>
        ) : null}

        {/* Carga por persona */}
        {people.length ? (
          <>
            <Text style={s.h2} minPresenceAhead={70}>{t("Carga por persona")}</Text>
            <Table
              rows={people}
              cols={[
                { label: t("Persona"), width: "60%", render: (p) => p.name },
                { label: "Pendientes", width: "20%", render: (p) => String(p.open) },
                { label: "Vencidas", width: "20%", render: (p) => <Text style={p.overdue ? { color: C.red, fontFamily: "Helvetica-Bold" } : undefined}>{p.overdue}</Text> },
              ]}
            />
          </>
        ) : null}

        {/* Terminadas recientemente */}
        {r.recentDone.length ? (
          <>
            <Text style={s.h2} minPresenceAhead={70}>{t("Terminadas en los últimos {n} días", { n: RECENT_DONE_DAYS })}</Text>
            <Table
              rows={r.recentDone}
              cols={[
                { label: t("Tarea"), width: "58%", render: titleCell },
                { label: t("Tipo"), width: "20%", render: (t) => t.kind },
                { label: t("Columna"), width: "22%", render: (t) => t.column },
              ]}
            />
          </>
        ) : null}

        {/* Releases */}
        {r.releases.length ? (
          <>
            <Text style={s.h2} minPresenceAhead={70}>{t("Últimas releases")}</Text>
            <Table
              rows={r.releases}
              cols={[
                { label: t("Nº"), width: "9%", render: (x) => `R${x.number}` },
                { label: t("Título"), width: "56%", render: (x) => x.title },
                { label: t("Fecha"), width: "21%", render: (x) => formatDay(x.deployedAt.slice(0, 10), r.today, locale) },
                { label: t("Tareas"), width: "14%", render: (x) => String(x.taskCount) },
              ]}
            />
          </>
        ) : null}

        <View style={s.footer} fixed>
          <Text>{r.project.name} · {t("Informe del {date}", { date: generated })}</Text>
          <Text render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}

export function renderReportPdf(report: Report, t: T = makeT("es"), locale = "es-ES"): Promise<Buffer> {
  return renderToBuffer(<ReportDocument r={report} t={t} locale={locale} />);
}

export interface WeekPlanPdfInput {
  project: string;
  column: string;
  today: string;
  generatedBy: string;
  groupBy: WeekPlanGroupBy;
  sections: WeekPlanSection[];
}

function WeekPlanDocument({ r, t, locale }: { r: WeekPlanPdfInput; t: T; locale: string }) {
  const byDay = r.groupBy === "day";
  const total = r.sections.reduce((n, sec) => n + sec.tasks.length, 0);
  const cols: Col<WeekPlanTask>[] = [
    { label: t("Tarea"), width: byDay ? "52%" : "50%", render: (x) => x.title },
    { label: t("Tipo"), width: "18%", render: (x) => x.kind },
    byDay
      ? { label: t("Responsable"), width: "30%", render: (x) => x.assigneeName ?? "—" }
      : { label: t("Fecha"), width: "32%", render: (x) => (x.dueDate ? formatDay(x.dueDate, r.today, locale) : "—") },
  ];
  return (
    <Document title={`${t("Planificación semanal")} · ${r.project}`} author="Pizarro" creator="Pizarro" producer="Pizarro">
      <Page size="A4" style={s.page}>
        <View style={s.header}>
          <Text style={s.eyebrow}>{t("Planificación semanal")}</Text>
          <Text style={s.title}>{r.column}</Text>
          <Text style={s.meta}>
            {r.project} · {t("Semana del {date}", { date: formatDay(r.today, undefined, locale) })} · {byDay ? t("Por día") : t("Por persona")} · {t("{n} tareas", { n: total })}
          </Text>
        </View>
        {r.sections.length === 0 && <Text style={s.small}>{t("No hay tareas en esta columna.")}</Text>}
        {r.sections.map((sec) => (
          <View key={sec.key}>
            <Text style={s.h3} minPresenceAhead={50}>{sec.label} <Text style={s.small}>({sec.tasks.length})</Text></Text>
            <Table rows={sec.tasks} cols={cols} />
          </View>
        ))}
        <View style={s.footer} fixed>
          <Text>{r.project} · {r.column}</Text>
          <Text render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}

export function renderWeekPlanPdf(input: WeekPlanPdfInput, t: T = makeT("es"), locale = "es-ES"): Promise<Buffer> {
  return renderToBuffer(<WeekPlanDocument r={input} t={t} locale={locale} />);
}

export interface ChecklistPdfInput {
  project: string;
  column: string;
  today: string;
  by: ChecklistGroupBy;
  groups: ChecklistGroup[];
}

function ChecklistDocument({ r, t, locale }: { r: ChecklistPdfInput; t: T; locale: string }) {
  const total = r.groups.reduce((n, g) => n + g.items.length, 0);
  const done = r.groups.reduce((n, g) => n + g.items.filter((i) => i.done).length, 0);
  return (
    <Document title={`${t("Lista consolidada")} · ${r.project}`} author="Pizarro" creator="Pizarro" producer="Pizarro">
      <Page size="A4" style={s.page}>
        <View style={s.header}>
          <Text style={s.eyebrow}>{t("Lista consolidada")}</Text>
          <Text style={s.title}>{r.column}</Text>
          <Text style={s.meta}>
            {r.project} · {formatDay(r.today, undefined, locale)} · {r.by === "card" ? t("Por tarjeta") : t("Por tipo de tarea")} · {t("{done} de {total} hechas", { done, total })}
          </Text>
        </View>
        {r.groups.length === 0 && <Text style={s.small}>{t("No hay subtareas en esta columna.")}</Text>}
        {r.groups.map((g) => (
          <View key={g.key}>
            <Text style={s.h3} minPresenceAhead={40}>{g.label} <Text style={s.small}>({g.items.filter((i) => i.done).length}/{g.items.length})</Text></Text>
            {g.items.map((it) => (
              <View key={it.id} style={{ flexDirection: "row", marginBottom: 2 }} wrap={false}>
                <Text style={{ width: 16, fontFamily: "Helvetica-Bold", color: it.done ? C.green : C.muted }}>{it.done ? "[x]" : "[ ]"}</Text>
                <Text style={{ flex: 1, color: it.done ? C.muted : C.text }}>
                  {it.title}
                  {r.by === "kind" ? <Text style={s.small}>  ({it.taskTitle})</Text> : null}
                </Text>
              </View>
            ))}
          </View>
        ))}
        <View style={s.footer} fixed>
          <Text>{r.project} · {r.column}</Text>
          <Text render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}

export function renderChecklistPdf(input: ChecklistPdfInput, t: T = makeT("es"), locale = "es-ES"): Promise<Buffer> {
  return renderToBuffer(<ChecklistDocument r={input} t={t} locale={locale} />);
}

/** Tarea tal como se entrega al cliente: sin comentarios, notas internas ni datos de personas. */
export interface DeliveryTask {
  title: string;
  kind: string;
  dueDate: string | null;
  subtaskTotal: number;
  doneSubtasks: string[];
}

export interface DeliveryPdfInput {
  project: string;
  column: string;
  today: string;
  tasks: DeliveryTask[];
}

function DeliveryDocument({ r, t, locale }: { r: DeliveryPdfInput; t: T; locale: string }) {
  return (
    <Document title={`${t("Resumen para el cliente")} · ${r.project}`} author="Pizarro" creator="Pizarro" producer="Pizarro">
      <Page size="A4" style={s.page}>
        <View style={s.header}>
          <Text style={s.eyebrow}>{t("Resumen para el cliente")}</Text>
          <Text style={s.title}>{r.project}</Text>
          <Text style={s.meta}>{r.column} · {formatDay(r.today, undefined, locale)} · {t("{n} tareas", { n: r.tasks.length })}</Text>
        </View>
        {r.tasks.length === 0 && <Text style={s.small}>{t("No hay tareas en esta columna.")}</Text>}
        {r.tasks.map((x, i) => (
          <View key={i} style={{ borderBottomWidth: 1, borderBottomColor: C.line, paddingVertical: 6 }} wrap={false}>
            <Text style={{ fontFamily: "Helvetica-Bold", fontSize: 10.5 }}>{x.title}</Text>
            <Text style={s.small}>
              {x.kind}
              {x.dueDate ? ` · ${t("Fecha")}: ${formatDay(x.dueDate, r.today, locale)}` : ""}
              {x.subtaskTotal > 0 ? ` · ${t("{done} de {total} subtareas hechas", { done: x.doneSubtasks.length, total: x.subtaskTotal })}` : ""}
            </Text>
            {x.doneSubtasks.map((title, j) => (
              <Text key={j} style={{ marginLeft: 8, marginTop: 1 }}>- {title}</Text>
            ))}
          </View>
        ))}
        <View style={s.footer} fixed>
          <Text>{r.project}</Text>
          <Text render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}

export function renderDeliveryPdf(input: DeliveryPdfInput, t: T = makeT("es"), locale = "es-ES"): Promise<Buffer> {
  return renderToBuffer(<DeliveryDocument r={input} t={t} locale={locale} />);
}
