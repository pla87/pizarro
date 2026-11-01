/** Quita de la ruta lo que no debe guardarse: tokens de un solo uso (/reset/<token>, /confirm/<token>) y la query (code, state, token…). */
export function redactPath(path: string): string {
  const base = path.split(/[?#]/)[0] ?? "";
  return base.replace(/^(\/(?:reset|confirm))\/[^/]+/, "$1/…");
}
