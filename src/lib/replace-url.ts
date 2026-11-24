/**
 * Cambia la dirección de la barra sin recargar ni pedir la página (p. ej. quitar `?task=`), de forma que el
 * enrutador de Next también la tome como la actual. Con el estado de Next del historial (`__NA`), su `replaceState`
 * parcheado no se entera: el siguiente `router.refresh()` (crear una tarea, un cambio en vivo) volvía a escribir la
 * dirección anterior y el parámetro quitado reaparecía (al recargar, el aviso o la tarea salían otra vez). Se conserva el
 * resto del estado (`pzModals`, `pzColumn`); Next vuelve a poner el suyo.
 */
export function replaceUrlKeepingState(url: URL | string): void {
  const state = { ...((window.history.state ?? {}) as Record<string, unknown>) };
  delete state.__NA;
  delete state._N;
  window.history.replaceState(state, "", url);
}
