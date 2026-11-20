// Etiquetas de los destinos de copia para la página de Administración: el host de un almacenamiento S3 compatible puede
// llevar el identificador de la cuenta (Cloudflare R2: «<id de cuenta>.r2.cloudflarestorage.com»). En la vista se
// recorta la primera parte del host; los logs, el estado guardado y los avisos por email no cambian.

/** «0123…cdef.r2.cloudflarestorage.com» → «…r2.cloudflarestorage.com». Un host de una o dos partes o una IP no se toca. */
export function maskHost(host: string): string {
  const [name, port] = host.split(/:(?=\d+$)/);
  if (!name || /^[\d.]+$/.test(name) || name.startsWith("[")) return host;
  const parts = name.split(".");
  if (parts.length < 3) return host;
  return `…${parts.slice(1).join(".")}${port ? `:${port}` : ""}`;
}

/** Etiqueta de un destino («S3 host/bucket/prefijo» o una carpeta) con el host recortado; el resto igual. */
export function maskDestinationLabel(label: string): string {
  const m = /^S3 ([^/\s]+)(.*)$/s.exec(label);
  return m ? `S3 ${maskHost(m[1]!)}${m[2]}` : label;
}

/** Recorta en un texto (p. ej. el error de una subida) cada aparición del host de la etiqueta de un destino S3. */
export function maskHostIn(text: string, label: string): string {
  const m = /^S3 ([^/\s]+)/.exec(label);
  if (!m) return text;
  const host = m[1]!;
  const masked = maskHost(host);
  if (masked === host) return text;
  const bare = host.replace(/:\d+$/, "");
  return text.split(host).join(masked).split(bare).join(maskHost(bare));
}

/** Lo mismo con varios destinos (p. ej. el último error de una tarea programada, que puede venir de cualquiera). */
export function maskHostsIn(text: string, labels: readonly string[]): string {
  return labels.reduce((acc, label) => maskHostIn(acc, label), text);
}
