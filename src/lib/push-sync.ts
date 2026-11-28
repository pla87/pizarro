"use client";

import { pushSetup, renewPush } from "@/actions/push";
import { currentPushSubscription, keyBytes, pushSupport, pushWorkerReady, rememberedPushHash, rememberPushHash, sameServerKey, sha256Hex } from "./push-client";

// Resincronización en silencio de los avisos push de este dispositivo: el navegador puede cambiar o perder la suscripción
// por su cuenta (el service worker lo intenta con `pushsubscriptionchange`, public/sw.js; esto cubre cuando no pudo). Se
// compara la huella de la suscripción actual con la que este navegador guardó al activar los avisos (rememberPushHash).
// Si el servidor ya no tiene el dispositivo (se quitó desde otro sitio) NO se vuelve a activar: solo se olvida la huella.

const ONCE_KEY = "pz-push-sync";

/** Devuelve true si cambió algo en el servidor. Nunca lanza ni enseña nada. */
export async function resyncPush(opts: { once?: boolean } = {}): Promise<boolean> {
  try {
    const stored = rememberedPushHash();
    if (!stored || pushSupport() !== "ok" || Notification.permission !== "granted") return false;
    const sub = await currentPushSubscription();
    const hash = sub ? await sha256Hex(sub.endpoint) : null;
    if (hash === stored) return false;
    if (opts.once) {
      if (sessionStorage.getItem(ONCE_KEY)) return false;
      sessionStorage.setItem(ONCE_KEY, "1");
    }
    const setup = await pushSetup();
    if (!setup.ok) return false;
    const { publicKey, devices } = setup.data;
    if (!devices.some((d) => d.hash === stored)) {
      // Quitado desde otro dispositivo (o ya cambiado): no se reactiva; solo se alinea la huella.
      rememberPushHash(hash && devices.some((d) => d.hash === hash) ? hash : null);
      return false;
    }
    let next = sub && sameServerKey(sub, publicKey) ? sub : null;
    if (!next) {
      const reg = await pushWorkerReady();
      if (sub) await sub.unsubscribe().catch(() => {});
      next = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) });
    }
    const json = next.toJSON();
    const res = await renewPush({ oldHash: stored, endpoint: json.endpoint ?? "", keys: { p256dh: json.keys?.p256dh ?? "", auth: json.keys?.auth ?? "" } });
    if (!res.ok) return false;
    rememberPushHash(await sha256Hex(next.endpoint));
    return true;
  } catch {
    return false;
  }
}
