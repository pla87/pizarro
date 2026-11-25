/** Quita de la ruta lo que no debe guardarse: tokens de los enlaces (/reset/<token>, /confirm/<token>, /unsubscribe/<token>, también bajo /api/, y /x/<token> de «Compartir fuera») y la query (code, state, token…). */
export function redactPath(path: string): string {
  const base = path.split(/[?#]/)[0] ?? "";
  return base.replace(/^(\/(?:reset|confirm|unsubscribe|api\/unsubscribe|x))\/[^/]+/, "$1/…");
}
