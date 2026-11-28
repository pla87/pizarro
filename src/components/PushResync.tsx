"use client";

import { useEffect } from "react";
import { resyncPush } from "@/lib/push-sync";

/** Al cargar la app con avisos activados en este dispositivo: si el navegador cambió la suscripción, se renueva en silencio (una vez por pestaña). */
export function PushResync() {
  useEffect(() => {
    void resyncPush({ once: true });
  }, []);
  return null;
}
