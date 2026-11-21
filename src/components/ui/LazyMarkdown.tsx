"use client";

import dynamic from "next/dynamic";
import { Suspense, type ComponentProps } from "react";
import { importWhenOnline } from "@/lib/connection";
import { Highlight } from "./Highlight";
import type { Markdown } from "./Markdown";

const Loaded = dynamic(() => importWhenOnline(() => import("./Markdown")).then((m) => m.Markdown));

/**
 * El mismo Markdown, pero con react-markdown y remark-gfm (unos 44 KB gz) fuera del código inicial de la página: para las
 * que solo lo pintan en una vista previa o un visor (plantillas de release, Documentación, una release desplegada, textos
 * legales). Con SSR la página ya llega pintada (y con la precarga del código); al abrirlo en el navegador, mientras llega,
 * el texto tal cual. Con su propio Suspense, como lazyDialog: sin él la carga suspendía hasta el loading.tsx más cercano y
 * la página se cambiaba un instante por su esqueleto. Sin red espera a que vuelva (importWhenOnline).
 */
export function LazyMarkdown(props: ComponentProps<typeof Markdown>) {
  return (
    <Suspense fallback={<div className="prose-md whitespace-pre-wrap"><Highlight text={props.children} query={props.highlight ?? ""} /></div>}>
      <Loaded {...props} />
    </Suspense>
  );
}
