import { getAppIcon } from "@/lib/app-icon";
import { rootIconResponse } from "@/lib/app-icon-render";

// Dirección fija de la raíz con el icono del color de la instalación (Administración → Ajustes → «Icono de la app»).
export const dynamic = "force-dynamic";

export async function GET() {
  return rootIconResponse(await getAppIcon(), "icon-192.png");
}
