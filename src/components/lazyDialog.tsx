"use client";

import dynamic from "next/dynamic";
import { Suspense, type ComponentType } from "react";
import { importWhenOnline } from "@/lib/connection";

/**
 * Un diálogo cargado aparte, con su propio Suspense sin nada que mostrar mientras llega su código. next/dynamic (con
 * ssr) no pone ninguno: la carga suspendía hasta el del loading.tsx más cercano y, al abrir un diálogo en una página recién
 * abierta, la página se cambiaba un instante por su esqueleto. Así la página sigue a la vista y el diálogo aparece en
 * cuanto llega; cada uno con el suyo, para que abrir el segundo no esconda el primero.
 */
function ownSuspense<P extends object>(Dialog: ComponentType<P>): ComponentType<P> {
  function WithSuspense(props: P) {
    return (
      <Suspense fallback={null}>
        <Dialog {...props} />
      </Suspense>
    );
  }
  return WithSuspense;
}

/**
 * Diálogo que no va en el código inicial de la página: `load` es el `import()` de su módulo (el mismo que se puede llamar
 * antes para precargarlo) y `pick` saca el componente. Si al abrirlo no hay red, espera a que vuelva (importWhenOnline) en
 * vez de fallar: el fallo llegaba a la pantalla de error, que recargaba la página sin red.
 */
export function lazyDialog<M, P extends object>(load: () => Promise<M>, pick: (m: M) => ComponentType<P>): ComponentType<P> {
  return ownSuspense(dynamic(() => importWhenOnline(load).then(pick)));
}
