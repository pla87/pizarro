// Rutas públicas cuyo último tramo es una credencial (token del calendario, enlaces de email de /reset/ y /confirm/):
// nunca deben llegar a los registros (Administración → Logs), ni en el campo «ruta» ni dentro de un mensaje de error.
// Funciones puras (sin dependencias del servidor) para poder probarlas y reutilizarlas.

/** Prefijos de ruta cuyo resto es un secreto. Para proteger otra ruta con token en la URL, basta añadirla aquí. */
export const SECRET_PATH_PREFIXES = ["/api/calendar/", "/reset/", "/confirm/"] as const;

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
// Hasta el primer espacio o cierre, sin llevarse la puntuación final de la frase («… /api/calendar/x: fallo»).
const SECRET_PATH_RE = new RegExp(`(${SECRET_PATH_PREFIXES.map(escapeRe).join("|")})[^\\s"'\`<>)\\]}]*[^\\s"'\`<>)\\]}.,:;!?]`, "gi");

const MASK = "…";

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/**
 * Sustituye lo que sigue a un prefijo secreto por «…»: `/api/calendar/<lo que sea>` → `/api/calendar/…`. Vale para una
 * ruta (con su query) y para un texto con rutas o direcciones dentro. También enmascara la forma con % (`/%72eset/…`).
 */
export function maskSecretPaths(text: string): string {
  if (!text) return text;
  const mask = (s: string) => s.replace(SECRET_PATH_RE, (_m, prefix: string) => `${prefix}${MASK}`);
  const direct = mask(text);
  if (!text.includes("%")) return direct;
  const decoded = safeDecode(text);
  // Si al descodificar aparece una ruta secreta escondida con %, se enmascara la versión descodificada.
  return decoded !== text && mask(decoded) !== decoded ? mask(decoded) : direct;
}

/** El secreto de una ruta (el tramo tras el prefijo, sin query), o null si la ruta no es de las protegidas. */
export function secretOfPath(path: string): string | null {
  const decoded = safeDecode(path);
  for (const prefix of SECRET_PATH_PREFIXES) {
    const at = decoded.toLowerCase().indexOf(prefix);
    if (at === -1) continue;
    const rest = decoded.slice(at + prefix.length).split(/[?#]/)[0]!;
    return rest || null;
  }
  return null;
}

/**
 * Texto apto para el registro de una petición a `path`: enmascara las rutas secretas que aparezcan y, además, cualquier
 * aparición literal del propio secreto de esa ruta (p. ej. un mensaje de error que lo repita fuera de una ruta). Con o sin
 * la extensión (`.ics`).
 */
export function maskSecretsFor(text: string, path: string | null | undefined): string {
  let out = maskSecretPaths(text);
  const secret = path ? secretOfPath(path) : null;
  if (secret) {
    for (const s of new Set([secret, secret.replace(/\.[A-Za-z0-9]{1,5}$/, ""), path ? (path.split(/[?#]/)[0]!.split("/").pop() ?? "") : ""])) {
      if (s.length >= 8) out = out.split(s).join(MASK);
    }
  }
  return out;
}
