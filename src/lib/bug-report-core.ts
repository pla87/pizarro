// «Informar de un error»: lógica pura (sin red ni base de datos), probada en tests/bug-report.test.ts. La usan
// next.config.ts (al compilar: ¿es una build oficial?) y el enlace de la app (dirección del formulario de GitHub).
//
// Regla de privacidad: la dirección del formulario solo lleva datos técnicos (versión, commit, tipo de instalación,
// navegador y sistema, idioma). Nunca datos de usuarios ni proyectos, emails ni la dirección de la instalación.

const OFFICIAL_REPO = "pla87/pizarro";
const BUG_REPORT_URL = `https://github.com/${OFFICIAL_REPO}/issues/new`;
export const BUG_REPORT_TEMPLATE = "bug_report.yml";
/** Fallos de seguridad: en privado (GitHub Security Advisories, «Report a vulnerability»), nunca en una incidencia. */
export const SECURITY_REPORT_URL = `https://github.com/${OFFICIAL_REPO}/security/advisories/new`;
/** Rama que solo recibe versiones publicadas (la mueve el workflow Release). */
const STABLE_BRANCH = "stable";

export type InstallKind = "docker" | "railway";

type Env = Record<string, string | undefined>;

/** Commit del código compilado: GIT_SHA (Docker) o el que pone Railway; solo hexadecimal, hasta 40 caracteres. */
export function buildCommit(env: Env): string {
  const raw = (env.GIT_SHA || env.RAILWAY_GIT_COMMIT_SHA || "").trim();
  return /^[0-9a-f]{7,40}$/i.test(raw) ? raw.toLowerCase() : "";
}

/**
 * ¿Es una build oficial sin modificar? Se decide al compilar y sin red, con lo que se sabe en ese momento:
 * - imagen del workflow Release: OFFICIAL_BUILD=1 y RELEASE_VERSION igual a la versión de package.json;
 * - Railway: el código viene del repositorio oficial (no de un fork), de la rama `stable` (solo versiones publicadas).
 * En ambos casos, versión X.Y.Z sin sufijo y un commit conocido. Es una pista para no recibir informes de versiones
 * modificadas, no una garantía: quien construye puede pasar esas variables.
 */
export function officialBuild(env: Env, version: string): InstallKind | null {
  if (!/^\d+\.\d+\.\d+$/.test(version) || !buildCommit(env)) return null;
  if (env.OFFICIAL_BUILD === "1" && (env.RELEASE_VERSION ?? "").replace(/^v/, "") === version) return "docker";
  const [owner, name] = OFFICIAL_REPO.split("/");
  if (
    (env.RAILWAY_GIT_REPO_OWNER ?? "").toLowerCase() === owner &&
    (env.RAILWAY_GIT_REPO_NAME ?? "").toLowerCase() === name &&
    env.RAILWAY_GIT_BRANCH === STABLE_BRANCH
  ) return "railway";
  return null;
}

/** Texto de la opción del desplegable «Cómo se instaló» de .github/ISSUE_TEMPLATE/bug_report.yml. */
function installLabel(kind: InstallKind | null): string {
  return kind === "docker" ? "Docker Compose" : kind === "railway" ? "Railway" : "";
}

/** «Chrome 140 · Windows» a partir del user agent: solo familia, versión mayor y sistema (nada que identifique). */
export function describeBrowser(ua: string): string {
  const pick = (re: RegExp) => re.exec(ua)?.[1];
  let browser = "";
  let v: string | undefined;
  if ((v = pick(/Edg(?:A|iOS)?\/(\d+)/))) browser = `Edge ${v}`;
  else if ((v = pick(/(?:OPR|Opera)\/(\d+)/))) browser = `Opera ${v}`;
  else if ((v = pick(/SamsungBrowser\/(\d+)/))) browser = `Samsung Internet ${v}`;
  else if ((v = pick(/(?:Firefox|FxiOS)\/(\d+)/))) browser = `Firefox ${v}`;
  else if ((v = pick(/(?:Chrome|CriOS)\/(\d+)/))) browser = `Chrome ${v}`;
  else if (/Safari\//.test(ua) && (v = pick(/Version\/(\d+(?:\.\d+)?)/))) browser = `Safari ${v}`;
  let os = "";
  if (/iPhone|iPad|iPod/.test(ua)) os = "iOS";
  else if (/Android/.test(ua)) os = "Android";
  else if (/CrOS/.test(ua)) os = "ChromeOS";
  else if (/Windows/.test(ua)) os = "Windows";
  else if (/Mac OS X|Macintosh/.test(ua)) os = "macOS";
  else if (/Linux/.test(ua)) os = "Linux";
  return [browser, os].filter(Boolean).join(" · ") || "?";
}

export interface BugReportFields {
  version: string;
  commit: string;
  install: InstallKind | null;
  browser: string;
  language: string;
}

/** Campos técnicos que se rellenan en el formulario (id del campo en bug_report.yml → valor), sin los vacíos. */
export function bugReportFields(f: BugReportFields): [string, string][] {
  const out: [string, string][] = [
    ["version", f.version],
    ["commit", f.commit],
    ["install", installLabel(f.install)],
    ["browser", f.browser],
    ["language", f.language],
  ];
  // Cada valor, recortado: nada largo ni con saltos de línea (son campos de una línea).
  return out.map(([k, v]): [string, string] => [k, v.replace(/[\r\n]+/g, " ").trim().slice(0, 120)]).filter(([, v]) => v !== "");
}

/** Formulario de sugerencias (.github/ISSUE_TEMPLATE/suggestion.yml), con los mismos campos técnicos. */
export const SUGGESTION_TEMPLATE = "suggestion.yml";
/** Campo del formulario donde va lo que escribe la persona en el diálogo: «Qué pasó» o «Tu sugerencia». */
export const ISSUE_TEXT_FIELD = { bug: "actual", idea: "idea" } as const;
/** Tope de la dirección entera: GitHub (y algunos navegadores y proxies) rechazan las muy largas. */
export const ISSUE_URL_MAX = 6000;

function issueUrlParts(f: BugReportFields, kind: "bug" | "idea", text: string) {
  const base: [string, string][] = [["template", kind === "idea" ? SUGGESTION_TEMPLATE : BUG_REPORT_TEMPLATE], ...bugReportFields(f)];
  const build = (body: string) => `${BUG_REPORT_URL}?${new URLSearchParams(body ? [...base, [ISSUE_TEXT_FIELD[kind], body]] : base).toString()}`;
  return { build, full: text.replace(/\r\n?/g, "\n").trim() };
}

/** ¿Llega entero lo escrito al formulario de GitHub? Si no, bugReportUrl lo recorta y el diálogo lo avisa. */
export function bugReportTextFits(f: BugReportFields, kind: "bug" | "idea", text: string): boolean {
  const { build, full } = issueUrlParts(f, kind, text);
  return build(full).length <= ISSUE_URL_MAX;
}

/**
 * Dirección del formulario de GitHub con los campos técnicos ya rellenos y, si lo hay, lo escrito en el diálogo
 * (recortado, con «…», para que la dirección no pase de ISSUE_URL_MAX).
 */
export function bugReportUrl(f: BugReportFields, kind: "bug" | "idea" = "bug", text = ""): string {
  const { build, full } = issueUrlParts(f, kind, text);
  if (build(full).length <= ISSUE_URL_MAX) return build(full);
  // Lo más largo que cabe (búsqueda binaria sobre los caracteres, sin partir un par sustituto).
  const chars = Array.from(full);
  let lo = 0;
  let hi = chars.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (build(`${chars.slice(0, mid).join("").trimEnd()}…`).length <= ISSUE_URL_MAX) lo = mid;
    else hi = mid - 1;
  }
  return build(lo ? `${chars.slice(0, lo).join("").trimEnd()}…` : "");
}

interface TechInfo {
  version: string;
  commit: string;
  buildId: string | null;
  official: InstallKind | null;
  node: string;
  platform: string;
  /** Versión de PostgreSQL, o null si la base de datos no respondió. */
  postgres: string | null;
  migrations: { applied: number; pending: number; failed: number; unknown: number } | null;
  /** Nombres de las variables documentadas que están definidas (nunca su valor) y de las que tienen un valor no válido. */
  envSet: string[];
  envInvalid: string[];
  /** Funciones activas (email, Google, copias…), por nombre. */
  features: string[];
  timeZone: string;
}

/**
 * «Copiar información técnica» (Administración → Ajustes): texto para pegar en una incidencia. Sin datos personales,
 * sin la dirección de la instalación y sin el valor de ninguna variable: de las variables solo van los nombres.
 */
export function formatTechInfo(i: TechInfo): string {
  const m = i.migrations;
  const lines = [
    `Pizarro: ${i.version}`,
    `Official build: ${i.official ? `yes (${installLabel(i.official)})` : "no"}`,
    `Commit: ${i.commit || "?"}`,
    `Build ID: ${i.buildId ?? "?"}`,
    `Node: ${i.node} (${i.platform})`,
    `Database: ${i.postgres ? `PostgreSQL ${i.postgres}` : "not reachable"}`,
    `Migrations: ${m ? `${m.applied} applied, ${m.pending} pending${m.failed ? `, ${m.failed} failed` : ""}${m.unknown ? `, ${m.unknown} unknown (database newer than the app)` : ""}` : "?"}`,
    `Features: ${i.features.length ? i.features.join(", ") : "none"}`,
    `Env vars set: ${i.envSet.length ? i.envSet.join(", ") : "none"}`,
    ...(i.envInvalid.length ? [`Env vars with an invalid value: ${i.envInvalid.join(", ")}`] : []),
    `Time zone: ${i.timeZone}`,
  ];
  return lines.join("\n");
}
