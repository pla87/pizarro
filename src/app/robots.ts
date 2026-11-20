import type { MetadataRoute } from "next";
import { landingIsPublic, robotsRules } from "@/lib/robots";

// /robots.txt sin sesión (queda fuera del proxy, src/proxy.ts): una instalación privada no se rastrea. Se genera en cada
// petición porque depende de LANDING_AT_ROOT, que se lee al arrancar, no al compilar.
export const dynamic = "force-dynamic";

export default function robots(): MetadataRoute.Robots {
  return robotsRules(landingIsPublic());
}
