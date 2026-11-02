import { redirect } from "next/navigation";

// «Tipos de tarea» vive ahora dentro de «Tipos y plantillas»; la dirección antigua sigue funcionando.
export default function KindsPage() {
  redirect("/admin/templates?vista=tipos");
}
