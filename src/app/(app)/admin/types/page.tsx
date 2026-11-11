import { redirect } from "next/navigation";

// «Tipos de tarea» vive ahora dentro de «Tipos y plantillas»; la dirección antigua sigue funcionando
// (la redirige next.config.ts; esto solo queda por si se quita de allí).
export default function KindsPage() {
  redirect("/admin/templates?vista=tipos");
}
