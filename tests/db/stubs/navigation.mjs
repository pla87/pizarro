// next/navigation sin el runtime cliente de React (con la condición react-server no carga): mismos errores con `digest`
// que lanza Next, para que runAction los propague igual que en producción.
export function redirect(url) {
  throw Object.assign(new Error("NEXT_REDIRECT"), { digest: `NEXT_REDIRECT;replace;${url};307;` });
}
export function notFound() {
  throw Object.assign(new Error("NEXT_HTTP_ERROR_FALLBACK;404"), { digest: "NEXT_HTTP_ERROR_FALLBACK;404" });
}
export const permanentRedirect = redirect;
