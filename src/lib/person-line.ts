/**
 * «Nombre · email» de una persona del resumen de importación, sin repetir: con solo el email (una columna de CSV con
 * direcciones) o con el nombre igual al email, el email una vez. Antes salía «desconocido@example.com ·
 * desconocido@example.com».
 */
export function personLine(p: { name: string; email: string }): string {
  const name = p.name.trim();
  const email = p.email.trim();
  if (!email) return name;
  if (!name || name.toLowerCase() === email.toLowerCase()) return email;
  return `${name} · ${email}`;
}
