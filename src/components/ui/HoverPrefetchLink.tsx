"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ComponentProps } from "react";

type Props = Omit<ComponentProps<typeof Link>, "href" | "prefetch"> & { href: string };

/**
 * Enlace de la barra lateral y los menús fijos: no se precarga al verse, sino al pasar el ratón, enfocarlo con el
 * teclado o tocarlo. Con la precarga normal de Next, cada router.refresh() del tablero (al volver a la pestaña, al
 * llegar un cambio en vivo…) volvía a pedir la página de cada enlace visible: ~10 peticiones por pestaña y por cambio.
 * (prefetch={false} también quita la precarga de Next al pasar el ratón: por eso se hace aquí con router.prefetch.)
 */
export function HoverPrefetchLink({ href, onMouseEnter, onFocus, onTouchStart, ...props }: Props) {
  const router = useRouter();
  const prefetch = () => router.prefetch(href);
  return (
    <Link
      {...props}
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
