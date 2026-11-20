import { AdminSkeleton } from "@/components/ui/ProjectLoading";

// Al cambiar de pestaña en Administración, el contenido se cambia en seguida por el esqueleto bajo el título y las
// pestañas (el layout se queda), en vez de seguir en la pestaña anterior sin ninguna señal hasta que llega la nueva.
// Mismo marco que los de los proyectos: aparece a los 200 ms (sin parpadeo en las cargas rápidas) y anuncia «Cargando…».
export default function Loading() {
  return <AdminSkeleton />;
}
