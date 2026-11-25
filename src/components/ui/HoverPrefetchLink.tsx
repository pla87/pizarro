"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, type ComponentProps } from "react";
import { saveDataOn } from "@/lib/connection";

type Props = Omit<ComponentProps<typeof Link>, "href" | "prefetch" | "ref"> & { href: string };

/**
 * Enlace de la barra lateral y los menús fijos: no se precarga al verse, sino al pasar el ratón, enfocarlo con el
 * teclado o tocarlo. Con la precarga normal de Next, cada router.refresh() del tablero (al volver a la pestaña, al
 * llegar un cambio en vivo…) volvía a pedir la página de cada enlace visible: ~10 peticiones por pestaña y por cambio.
 * (prefetch={false} también quita la precarga de Next al pasar el ratón: por eso se hace aquí con router.prefetch.)
 * Con «Ahorro de datos» no se precarga: la página se pide al pulsar.
 */
export function HoverPrefetchLink({ href, onMouseEnter, onFocus, onTouchStart, ...props }: Props) {
  const router = useRouter();
  const ref = useRef<HTMLAnchorElement>(null);
  const prefetch = () => {
    if (!saveDataOn()) router.prefetch(href);
  };
  // Si el destino cambia con el ratón ya encima (o con el foco), no llega otro mouseenter: se precarga el nuevo. Pasa al
  // cambiar de proyecto en el selector si el puntero queda sobre «Releases» de la barra lateral: el enlace pasa a ser el
  // del proyecto nuevo sin que el ratón salga y entre. Sin precarga, al pulsarlo Next no tiene el loading.tsx de Releases
  // y, mientras llega la página, enseña el de más arriba (el esqueleto del tablero).
  useEffect(() => {
    const el = ref.current;
    if (el && (el.matches(":hover") || el === document.activeElement) && !saveDataOn()) router.prefetch(href);
  }, [href, router]);
  return (
    <Link
      {...props}
      ref={ref}
      href={href}
      prefetch={false}
      onMouseEnter={(e) => {
        prefetch();
        onMouseEnter?.(e);
      }}
      onFocus={(e) => {
        prefetch();
        onFocus?.(e);
      }}
      onTouchStart={(e) => {
        prefetch();
        onTouchStart?.(e);
      }}
    />
  );
}
