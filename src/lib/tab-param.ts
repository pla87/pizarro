// Pestaña pedida en `?tab=` (Mi perfil, Ajustes del proyecto). Además del id, cada pestaña admite otros nombres
// esperables (alias: «plantillas» para la que se llama así pero cuyo id es «releases», el nombre en inglés…), sin
// distinguir mayúsculas ni tildes. Un valor que no es de ninguna no cae en silencio en la primera: la página lo avisa.

export interface TabSpec<T extends string> {
  id: T;
  aliases?: readonly string[];
}

/** default: sin `?tab=`; exact: el id; alias: otro nombre de una pestaña (la página redirige al id); unknown: ninguna. */
export type TabResolution<T extends string> = { tab: T; kind: "default" | "exact" | "alias" | "unknown"; asked?: string };

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLowerCase();

export function resolveTabParam<T extends string>(value: unknown, tabs: readonly TabSpec<T>[]): TabResolution<T> {
  const first = tabs[0]!.id;
  if (value === undefined || value === null || value === "") return { tab: first, kind: "default" };
  if (typeof value !== "string") return { tab: first, kind: "unknown", asked: String(Array.isArray(value) ? (value[0] ?? "") : "").slice(0, 40) };
  const exact = tabs.find((t) => t.id === value);
  if (exact) return { tab: exact.id, kind: "exact" };
  const v = norm(value);
  const alias = tabs.find((t) => norm(t.id) === v || t.aliases?.some((a) => norm(a) === v));
  if (alias) return { tab: alias.id, kind: "alias" };
  return { tab: first, kind: "unknown", asked: value.slice(0, 40) };
}
