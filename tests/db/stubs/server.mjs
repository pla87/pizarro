// next/server fuera de una petición: `after` ejecuta la tarea al momento (en los tests no hay SMTP ni
// WhatsApp configurados, así que no hay envíos externos) y NextResponse no se usa en las acciones.
export function after(task) {
  return Promise.resolve(typeof task === "function" ? task() : task).catch(() => {});
}
export const NextResponse = { json: (body, init) => new Response(JSON.stringify(body), init) };
