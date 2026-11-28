// Avisos push en el navegador (lado del cliente): si este navegador los admite, su suscripción y cómo olvidarla al cerrar
// sesión. Sin dependencias ni zod (llega al navegador).

/** Qué admite este navegador: todo, nada, solo con la app instalada (iPhone/iPad) o solo con https. */
export type PushSupport = "ok" | "unsupported" | "ios-install" | "insecure";

export function pushSupport(): PushSupport {
  if (typeof window === "undefined") return "unsupported";
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const has = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
  if (!window.isSecureContext) return "insecure";
  // Safari en iPhone/iPad solo tiene push con la app en la pantalla de inicio (iOS 16.4 o posterior).
  if (!has) return ios ? "ios-install" : "unsupported";
  return "ok";
}

/** Clave pública VAPID (base64url) en bytes, para applicationServerKey. */
export function keyBytes(b64url: string): Uint8Array<ArrayBuffer> {
  const b64 = b64url.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** ¿Se hizo esta suscripción con esta clave? (si la instalación cambió de clave, hay que suscribirse otra vez). */
export function sameServerKey(sub: PushSubscription, publicKey: string): boolean {
  const key = sub.options?.applicationServerKey;
  if (!key) return false;
  const a = new Uint8Array(key);
  const b = keyBytes(publicKey);
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

/** SHA-256 en hexadecimal (la huella del endpoint con la que el servidor reconoce este dispositivo). */
export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** La suscripción push de este navegador, si la hay (sin registrar el service worker si no lo estaba). */
export async function currentPushSubscription(): Promise<PushSubscription | null> {
  if (pushSupport() !== "ok") return null;
  const reg = await navigator.serviceWorker.getRegistration();
  return (await reg?.pushManager.getSubscription()) ?? null;
}

/**
 * Al cerrar sesión: este navegador deja de recibir avisos (en un ordenador compartido no deben seguir llegando los de
 * esta cuenta). El servicio push responde 410 al siguiente envío y el servidor borra la suscripción.
 */
export function forgetPushOnThisDevice(): void {
  rememberPushHash(null);
  currentPushSubscription()
    .then((s) => s?.unsubscribe())
    .catch(() => {});
}

// --- Qué suscripción se guardó en este navegador ---

const HASH_KEY = "pz-push-hash";

/** Huella de la suscripción con la que este navegador activó los avisos (null: ninguna). Solo para detectar que el navegador la cambió. */
export function rememberedPushHash(): string | null {
  try {
    return localStorage.getItem(HASH_KEY);
  } catch {
    return null;
  }
}

export function rememberPushHash(hash: string | null): void {
  try {
    if (hash) localStorage.setItem(HASH_KEY, hash);
    else localStorage.removeItem(HASH_KEY);
  } catch {
    // Sin almacenamiento (ventana privada): no se puede resincronizar sola, solo desde Mi perfil.
  }
}

/** Registra el service worker y espera a que esté activo (con tiempo máximo: si el registro falla, `ready` no acaba nunca). */
export async function pushWorkerReady(timeoutMs = 10_000): Promise<ServiceWorkerRegistration> {
  await navigator.serviceWorker.register("/sw.js");
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      navigator.serviceWorker.ready,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("service worker timeout")), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/** Sistema y navegador, para decir dónde mirar si el aviso de prueba no se ve (los permisos del sistema lo bloquean aunque el navegador lo tenga permitido). */
export function notificationSettingsHint(ua: string): { os: "windows" | "mac" | "other"; browser: string } {
  const browser = /edg\//i.test(ua) ? "Microsoft Edge" : /firefox\//i.test(ua) ? "Firefox" : /opr\//i.test(ua) ? "Opera" : "Google Chrome";
  const os = /windows/i.test(ua) ? "windows" : /macintosh|mac os x/i.test(ua) && !/mobile/i.test(ua) ? "mac" : "other";
  return { os, browser };
}
