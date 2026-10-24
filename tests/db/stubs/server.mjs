// next/server fuera de una petición: `after` ejecuta la tarea al momento (en los tests no hay SMTP ni
// WhatsApp configurados, así que no hay envíos externos) y NextResponse no se usa en las acciones.
// Las promesas quedan en globalThis.__pzAfter para que un test pueda esperar a que terminen (afterDone en helpers).
export function after(task) {
  const p = Promise.resolve(typeof task === "function" ? task() : task).catch(() => {});
  (globalThis.__pzAfter ??= []).push(p);
  return p;
}
export const NextResponse = { json: (body, init) => new Response(JSON.stringify(body), init) };
