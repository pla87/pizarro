"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

// Secciones que pasaron de Ajustes a Integraciones: un enlace antiguo (/admin/settings#acceso-google) sigue llevando a
// su sitio. El ancla no llega al servidor, así que se mira en el navegador (al cargar y si cambia sin recargar).
const MOVED = new Set(["avisos-email", "acceso-google", "mensajeria"]);

export function MovedSectionRedirect() {
  const router = useRouter();
  useEffect(() => {
    const go = () => {
      const hash = window.location.hash.slice(1);
      if (MOVED.has(hash)) router.replace(`/admin/integrations#${hash}`);
    };
    go();
    window.addEventListener("hashchange", go);
    return () => window.removeEventListener("hashchange", go);
  }, [router]);
  return null;
}
