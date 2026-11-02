"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import { useT } from "@/i18n/client";

// La demo (y @dnd-kit) se descarga solo cuando el visitante se acerca a ella: la página se queda ligera.
const LandingDemo = dynamic(() => import("./LandingDemo"), {
  ssr: false,
  loading: () => <div className="card h-80 animate-pulse" aria-hidden />,
});

export function LandingDemoLoader() {
  const t = useT();
  const ref = useRef<HTMLDivElement>(null);
  const [show, setShow] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") {
      setShow(true);
      return;
    }
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        setShow(true);
        io.disconnect();
      }
    }, { rootMargin: "600px" });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    <div ref={ref} className="min-h-80">
      {show ? <LandingDemo /> : <div className="card h-80" role="status" aria-label={t("Cargando la demo…")} />}
    </div>
  );
}
