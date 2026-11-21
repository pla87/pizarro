/** Solo rutas internas: evita redirecciones abiertas (//, \\, tabuladores, etc.). */
export function safeNextPath(next: string): string {
  if (!next.startsWith("/") || /[\x00-\x1f\\]/.test(next)) return "/";
  try {
    const url = new URL(next, "http://internal.invalid");
    // Tras normalizar, «/.//x», «/a/..//x» o «/%2e//x» quedan en «//x», que el navegador lee como otro dominio.
    if (url.origin !== "http://internal.invalid" || /^\/[/\\]/.test(url.pathname)) return "/";
    return url.pathname + url.search;
  } catch {
    return "/";
  }
}
