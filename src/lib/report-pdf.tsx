import "server-only";
import { Document, Font, Page, StyleSheet, Text, View, renderToBuffer } from "@react-pdf/renderer";
import { formatDay } from "./dates";
import type { DeliverableStatus, Report, ReportTask } from "./report";

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
  kpis: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  kpi: { width: "23.8%", borderWidth: 1, borderColor: C.line, borderRadius: 6, padding: 7, backgroundColor: C.soft },
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
  empty: { fontSize: 8.5, color: C.faint, fontStyle: "italic" },
  footer: { position: "absolute", bottom: 20, left: 36, right: 36, flexDirection: "row", justifyContent: "space-between", fontSize: 7.5, color: C.faint },
});

function Bar({ value, color = C.brand }: { value: number; color?: string }) {
  return (
    <View style={s.barTrack}>
      <View style={[s.barFill, { width: `${Math.max(0, Math.min(100, value))}%`, backgroundColor: color }]} />
    </View>
  );
}

function dueLabel(t: { dueDate: string | null; daysLeft: number | null; done?: boolean }, today: string): string {
  if (!t.dueDate) return "—";
  const date = formatDay(t.dueDate, today);
  if (t.done || t.daysLeft === null) return date;
  if (t.daysLeft < 0) return `${date} (hace ${-t.daysLeft} d)`;
  if (t.daysLeft === 0) return `${date} (hoy)`;
  return `${date} (en ${t.daysLeft} d)`;
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

function Table<T>({ cols, rows, empty }: { cols: Col<T>[]; rows: T[]; empty: string }) {
  if (!rows.length) return <Text style={s.empty}>{empty}</Text>;
  return (
    <View style={s.table}>
      <View style={[s.tr, s.th]} fixed>
        {cols.map((c) => (
          <Text key={c.label} style={[s.td, { width: c.width }]}>{c.label}</Text>
        ))}
      </View>
      {rows.map((row, i) => (
        <View key={i} style={i === rows.length - 1 ? s.trLast : s.tr} wrap={false}>
          {cols.map((c) => (
            <View key={c.label} style={[s.td, { width: c.width }]}>
              {(() => {
                const v = c.render(row);
                return typeof v === "string" || typeof v === "number" ? <Text>{v}</Text> : v;
              })()}
            </View>
          ))}
        </View>
      ))}
    </View>
  );
}

function taskCols(today: string, withColumn: boolean): Col<ReportTask>[] {
  return [
    { label: "Tarea", width: withColumn ? "34%" : "44%", render: (t) => <Text style={t.done ? { color: C.muted } : undefined}>{t.title}</Text> },
    { label: "Tipo", width: "10%", render: (t) => t.kind },
    ...(withColumn ? [{ label: "Columna", width: "17%", render: (t: ReportTask) => t.column }] : []),
    { label: "Responsable", width: withColumn ? "15%" : "17%", render: (t) => t.assignee ?? "—" },
    { label: "Plazo", width: withColumn ? "15%" : "19%", render: (t) => <Text style={{ color: dueColor(t) }}>{dueLabel(t, today)}</Text> },
    { label: "Checklist", width: "9%", render: (t) => t.checklist ?? "—" },
  ];
}

function ReportDocument({ r }: { r: Report }) {
  const generated = formatDay(r.today);
  return (
    <Document title={`Informe · ${r.project.name}`} author="Pizarro" creator="Pizarro" producer="Pizarro">
      <Page size="A4" style={s.page}>
        <View style={s.header}>
          <Text style={s.eyebrow}>Informe de estado del proyecto</Text>
          <Text style={s.title}>{r.project.name}</Text>
          <Text style={s.meta}>Generado el {generated} por {r.generatedBy}</Text>
          {r.project.description ? <Text style={s.desc}>{r.project.description}</Text> : null}
        </View>

        {/* Resumen */}
        <Text style={[s.h2, { marginTop: 0 }]}>Resumen</Text>
        <View style={{ marginBottom: 8 }}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 3 }}>
            <Text style={{ fontFamily: "Helvetica-Bold" }}>Avance global: {r.kpis.progressPct}%</Text>
            <Text style={s.small}>{r.kpis.done} de {r.kpis.total} tarjetas terminadas</Text>
          </View>
          <Bar value={r.kpis.progressPct} color={C.green} />
        </View>
        <View style={s.kpis}>
          {[
            { v: r.kpis.open, l: "Pendientes", c: C.text },
            { v: r.kpis.overdue, l: "Con plazo vencido", c: r.kpis.overdue ? C.red : C.text },
            { v: r.kpis.dueSoon, l: "Vencen en 7 días", c: r.kpis.dueSoon ? C.amber : C.text },
            { v: r.deliverables.length, l: "Entregables", c: C.text },
            { v: r.kpis.unassignedOpen, l: "Pendientes sin responsable", c: C.text },
            { v: r.kpis.withoutDueOpen, l: "Pendientes sin plazo", c: C.text },
            { v: r.kpis.done, l: "Terminadas", c: C.green },
            { v: r.kpis.archived, l: "Archivadas", c: C.muted },
          ].map((k) => (
            <View key={k.l} style={s.kpi}>
              <Text style={[s.kpiValue, { color: k.c }]}>{k.v}</Text>
              <Text style={s.kpiLabel}>{k.l}</Text>
            </View>
          ))}
        </View>

        {/* Columnas */}
        <Text style={s.h2}>Estado por columna</Text>
        <Table
          empty="El proyecto no tiene columnas."
          rows={r.columns}
          cols={[
            { label: "Columna", width: "30%", render: (c) => <Text>{c.name}{c.isDone ? <Text style={s.small}>  (terminadas)</Text> : null}</Text> },
            { label: "Tarjetas", width: "11%", render: (c) => String(c.count) },
            { label: "Peso", width: "22%", render: (c) => <Bar value={r.kpis.total ? (c.count / r.kpis.total) * 100 : 0} color={c.isDone ? C.green : C.brand} /> },
            { label: "Por tipo", width: "26%", render: (c) => <Text style={s.small}>{c.byType.map((t) => `${t.label} ${t.count}`).join(" · ") || "—"}</Text> },
            { label: "Vencidas", width: "11%", render: (c) => <Text style={c.overdue ? { color: C.red, fontFamily: "Helvetica-Bold" } : undefined}>{c.overdue}</Text> },
          ]}
        />

        {/* Entregables */}
        <Text style={s.h2}>Entregables</Text>
        <Table
          empty="No hay entregables definidos. Créalos en «Ajustes del proyecto»."
          rows={r.deliverables}
          cols={[
            { label: "Entregable", width: "32%", render: (d) => <View><Text style={{ fontFamily: "Helvetica-Bold" }}>{d.name}</Text>{d.description ? <Text style={s.small}>{d.description}</Text> : null}</View> },
            { label: "Fecha objetivo", width: "18%", render: (d) => dueLabel({ dueDate: d.dueDate, daysLeft: d.daysLeft, done: d.status === "Completado" }, r.today) },
            { label: "Avance", width: "26%", render: (d) => <View><Text style={s.small}>{d.done}/{d.total} · {d.pct}%</Text><Bar value={d.pct} color={STATUS_COLOR[d.status]} /></View> },
            { label: "Estado", width: "24%", render: (d) => <View style={{ flexDirection: "row" }}><Text style={[s.pill, { backgroundColor: STATUS_COLOR[d.status] }]}>{d.status}</Text></View> },
          ]}
        />

        {/* Plazos */}
        <Text style={s.h2} minPresenceAhead={60}>Plazos</Text>
        <Text style={s.h3}>Vencidos ({r.overdue.length})</Text>
        <Table empty="No hay tareas pendientes con el plazo vencido." rows={r.overdue} cols={taskCols(r.today, true)} />
        <Text style={s.h3}>Próximos 14 días ({r.upcoming.length})</Text>
        <Table empty="No hay plazos en los próximos 14 días." rows={r.upcoming} cols={taskCols(r.today, true)} />

        {/* Personas y tipos */}
        <View style={{ flexDirection: "row", gap: 12 }} wrap={false}>
          <View style={{ flex: 1.3 }}>
            <Text style={s.h2}>Carga por persona</Text>
            <Table
              empty="Sin tarjetas."
              rows={r.people}
              cols={[
                { label: "Persona", width: "46%", render: (p) => p.name },
                { label: "Pendientes", width: "20%", render: (p) => String(p.open) },
                { label: "Vencidas", width: "17%", render: (p) => <Text style={p.overdue ? { color: C.red } : undefined}>{p.overdue}</Text> },
                { label: "Hechas", width: "17%", render: (p) => String(p.done) },
              ]}
            />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={s.h2}>Por tipo</Text>
            <Table
              empty="Sin tarjetas."
              rows={r.types}
              cols={[
                { label: "Tipo", width: "44%", render: (t) => t.label },
                { label: "Pendientes", width: "30%", render: (t) => String(t.open) },
                { label: "Hechas", width: "26%", render: (t) => String(t.done) },
              ]}
            />
          </View>
        </View>

        {/* Releases */}
        <Text style={s.h2}>Últimas releases</Text>
        <Table
          empty="Todavía no se ha registrado ninguna release."
          rows={r.releases}
          cols={[
            { label: "Release", width: "60%", render: (x) => x.title },
            { label: "Fecha", width: "25%", render: (x) => formatDay(x.deployedAt.slice(0, 10), r.today) },
            { label: "Tareas", width: "15%", render: (x) => String(x.taskCount) },
          ]}
        />

        {/* Detalle */}
        <Text style={s.h2} break>Detalle por columna</Text>
        {r.columns.map((c) => (
          <View key={c.name} style={{ marginBottom: 6 }}>
            <Text style={s.h3} minPresenceAhead={40}>{c.name} · {c.count}</Text>
            <Table empty="Sin tarjetas." rows={c.tasks} cols={taskCols(r.today, false)} />
          </View>
        ))}

        <View style={s.footer} fixed>
          <Text>{r.project.name} · Informe del {generated}</Text>
          <Text render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}

export function renderReportPdf(report: Report): Promise<Buffer> {
  return renderToBuffer(<ReportDocument r={report} />);
}
