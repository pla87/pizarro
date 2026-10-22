// Política de acceso según el entorno. Por defecto se permiten contraseña y Google.
//   AUTH_GOOGLE_ONLY=true           solo se entra con Google...
//   AUTH_ALLOW_ADMIN_PASSWORD=true  ...salvo los administradores, que conservan la contraseña (acceso de emergencia).
// Sin Google configurado «solo Google» no tiene efecto: dejaría a todo el mundo fuera.

type Env = Record<string, string | undefined>;

export const isGoogleLoginConfigured = (env: Env = process.env): boolean => Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET && env.APP_URL);

export const googleOnly = (env: Env = process.env): boolean => env.AUTH_GOOGLE_ONLY === "true" && isGoogleLoginConfigured(env);

/** ¿Puede esta persona entrar con contraseña? */
export function passwordLoginAllowed(role: "ADMIN" | "MEMBER", env: Env = process.env): boolean {
  if (!googleOnly(env)) return true;
  return role === "ADMIN" && env.AUTH_ALLOW_ADMIN_PASSWORD === "true";
}

/** ¿Se enseña el formulario de contraseña en la pantalla de acceso? (con «solo Google», solo si hay acceso de emergencia) */
export function passwordFormVisible(env: Env = process.env): boolean {
  return !googleOnly(env) || env.AUTH_ALLOW_ADMIN_PASSWORD === "true";
}
