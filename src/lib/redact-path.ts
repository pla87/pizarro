/** Quita de la ruta lo que no debe guardarse: tokens de los enlaces (/reset/<token>, /confirm/<token>, /unsubscribe/<token>, también bajo /api/) y la query (code, state, token…). */
export function redactPath(path: string): string {
  const base = path.split(/[?#]/)[0] ?? "";
  return base.replace(/^(\/(?:reset|confirm|unsubscribe|api\/unsubscribe))\/[^/]+/, "$1/…");
}
