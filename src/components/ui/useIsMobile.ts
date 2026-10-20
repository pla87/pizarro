"use client";

import { useSyncExternalStore } from "react";

const QUERY = "(max-width: 767px)";

/** true en pantallas de móvil (por debajo de md). En el servidor, false. */
export function useIsMobile(): boolean {
  return useSyncExternalStore(
    (cb) => {
      const mq = window.matchMedia(QUERY);
      mq.addEventListener("change", cb);
      return () => mq.removeEventListener("change", cb);
    },
    () => window.matchMedia(QUERY).matches,
    () => false,
  );
}
