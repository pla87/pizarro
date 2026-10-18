/** Solo rutas internas: evita redirecciones abiertas (//, \\, tabuladores, etc.). */
export function safeNextPath(next: string): string {
  if (!next.startsWith("/") || /[\x00-\x1f\\]/.test(next)) return "/";
  try {
    const url = new URL(next, "http://internal.invalid");
    return url.origin === "http://internal.invalid" ? url.pathname + url.search : "/";
  } catch {
    return "/";
  }
}
