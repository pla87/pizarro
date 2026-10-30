import "server-only";
import { db } from "./db";
import { GOOGLE_CONTACT_KEY } from "./google-config-core";
import { LEGAL_KINDS, LEGAL_RESPONSIBLE_KEY, legalTextKey, legalUpdatedKey, type LegalKind, type LegalTexts } from "./legal-core";

// Textos legales editables (Administración → Textos legales), guardados en AppState: texto propio por página e idioma
// (vacío = se usa el genérico), fecha de última modificación por página y nombre del responsable. El email de contacto
// público es el mismo que se edita en Ajustes → Acceso con Google (google.publicContactEmail).

export interface LegalSettings {
  responsible: string;
  email: string;
  texts: Record<LegalKind, LegalTexts>;
  updatedAt: Record<LegalKind, string | null>;
}

const KEYS = [
  LEGAL_RESPONSIBLE_KEY, GOOGLE_CONTACT_KEY,
  ...LEGAL_KINDS.flatMap((k) => [legalTextKey(k, "es"), legalTextKey(k, "en"), legalUpdatedKey(k)]),
];

/** Lectura directa: son páginas poco visitadas y la pantalla de administración necesita el valor al día. */
export async function getLegalSettings(): Promise<LegalSettings> {
  const rows = await db.appState.findMany({ where: { key: { in: KEYS } }, select: { key: true, value: true } }).catch(() => []);
  const get = (k: string) => rows.find((r) => r.key === k)?.value ?? "";
  const texts = (k: LegalKind): LegalTexts => ({ es: get(legalTextKey(k, "es")), en: get(legalTextKey(k, "en")) });
  return {
    responsible: get(LEGAL_RESPONSIBLE_KEY).trim(),
    email: get(GOOGLE_CONTACT_KEY).trim(),
    texts: { privacy: texts("privacy"), terms: texts("terms") },
    updatedAt: { privacy: get(legalUpdatedKey("privacy")) || null, terms: get(legalUpdatedKey("terms")) || null },
  };
}

async function put(tx: Pick<typeof db, "appState">, key: string, value: string) {
  if (value === "") await tx.appState.deleteMany({ where: { key } });
  else await tx.appState.upsert({ where: { key }, create: { key, value }, update: { value } });
}

/** Guarda los dos idiomas de una página (vacío = vuelve al texto por defecto) y anota la fecha. Devuelve qué idiomas cambiaron. */
export async function saveLegalTexts(kind: LegalKind, next: LegalTexts, now: Date = new Date()): Promise<{ changed: ("es" | "en")[]; settings: LegalSettings }> {
  const before = (await getLegalSettings()).texts[kind];
  const changed = (["es", "en"] as const).filter((l) => before[l] !== next[l]);
  if (changed.length) {
    await db.$transaction(async (tx) => {
      for (const l of changed) await put(tx, legalTextKey(kind, l), next[l]);
      // Sin ningún texto propio no hay fecha que mostrar.
      await put(tx, legalUpdatedKey(kind), next.es || next.en ? now.toISOString() : "");
    });
  }
  return { changed, settings: await getLegalSettings() };
}

/** Guarda el responsable y el email de contacto público. */
export async function saveLegalContact(responsible: string, email: string): Promise<{ responsibleChanged: boolean; emailChanged: boolean }> {
  const before = await getLegalSettings();
  await db.$transaction(async (tx) => {
    await put(tx, LEGAL_RESPONSIBLE_KEY, responsible);
    await tx.appState.upsert({ where: { key: GOOGLE_CONTACT_KEY }, create: { key: GOOGLE_CONTACT_KEY, value: email }, update: { value: email } });
  });
  return { responsibleChanged: before.responsible !== responsible, emailChanged: before.email !== email };
}
